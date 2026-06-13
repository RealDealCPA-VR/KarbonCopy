import { desc, eq, gte, isNotNull } from "drizzle-orm";
import { BellRing } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { AlertFeed } from "@/components/alerts/alert-feed";
import { AuditLog } from "@/components/alerts/audit-log";
import { StatsStrip, type AlertStats } from "@/components/alerts/stats-strip";
import type { AlertItem } from "@/components/alerts/types";

export const dynamic = "force-dynamic";

const { fileEvents, organizations, fileRules } = schema;

export default async function AlertsPage() {
  await requireUser();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86400_000);

  const rows = await db
    .select({
      id: fileEvents.id,
      event: fileEvents.event,
      filePath: fileEvents.filePath,
      fileName: fileEvents.fileName,
      sizeBytes: fileEvents.sizeBytes,
      status: fileEvents.status,
      organizationId: fileEvents.organizationId,
      workItemId: fileEvents.workItemId,
      acknowledgedById: fileEvents.acknowledgedById,
      acknowledgedAt: fileEvents.acknowledgedAt,
      detectedAt: fileEvents.detectedAt,
      clientName: organizations.name,
      ruleName: fileRules.name,
      severity: fileRules.severity,
    })
    .from(fileEvents)
    .leftJoin(organizations, eq(fileEvents.organizationId, organizations.id))
    .leftJoin(fileRules, eq(fileEvents.ruleId, fileRules.id))
    .orderBy(desc(fileEvents.detectedAt))
    .limit(100);

  const items = rows as AlertItem[];

  // distinct clients seen in events, for the filter dropdown
  const clientMap = new Map<string, string>();
  for (const r of items) {
    if (r.organizationId && r.clientName) clientMap.set(r.organizationId, r.clientName);
  }
  const clients = [...clientMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // stats
  const newToday = items.filter(
    (i) => new Date(i.detectedAt).getTime() >= startOfToday.getTime(),
  ).length;
  const totalWeek = items.filter(
    (i) => new Date(i.detectedAt).getTime() >= weekAgo.getTime(),
  ).length;
  const pendingNew = items.filter((i) => i.status === "new").length;

  const counts = new Map<string, { name: string; count: number }>();
  for (const r of items) {
    if (!r.organizationId || !r.clientName) continue;
    const c = counts.get(r.organizationId) ?? { name: r.clientName, count: 0 };
    c.count++;
    counts.set(r.organizationId, c);
  }
  const topClient = [...counts.values()].sort((a, b) => b.count - a.count)[0] ?? null;

  const stats: AlertStats = { newToday, totalWeek, topClient, pendingNew };

  // feed shows the most recent 50; audit log shows all 100
  const feedItems = items.slice(0, 50);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BellRing className="h-6 w-6 text-primary" />
            File Alerts
          </h1>
          <p className="text-muted-foreground">
            Live file-server completion alerts, auto-linked to your clients and work.
          </p>
        </div>
      </div>

      <StatsStrip stats={stats} />

      <AlertFeed initial={feedItems} clients={clients} />

      <AuditLog rows={items} />
    </div>
  );
}
