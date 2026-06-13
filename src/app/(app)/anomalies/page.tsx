import { desc, eq } from "drizzle-orm";
import { Radar as RadarIcon } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { Radar } from "@/components/anomalies/radar";
import { StatsStrip, type AnomalyStats } from "@/components/anomalies/stats-strip";
import type { AnomalyItem } from "@/components/anomalies/types";

export const dynamic = "force-dynamic";

const { anomalies, organizations } = schema;

export default async function AnomaliesPage() {
  await requireUser();

  const rows = await db
    .select({
      id: anomalies.id,
      organizationId: anomalies.organizationId,
      clientName: organizations.name,
      source: anomalies.source,
      kind: anomalies.kind,
      severity: anomalies.severity,
      title: anomalies.title,
      detail: anomalies.detail,
      amountCents: anomalies.amountCents,
      status: anomalies.status,
      detectedAt: anomalies.detectedAt,
      reviewedById: anomalies.reviewedById,
      meta: anomalies.meta,
    })
    .from(anomalies)
    .leftJoin(organizations, eq(anomalies.organizationId, organizations.id))
    .orderBy(desc(anomalies.detectedAt))
    .limit(500);

  const items = rows as AnomalyItem[];

  // stats over OPEN anomalies
  const open = items.filter((i) => i.status === "open");
  const stats: AnomalyStats = {
    openCritical: open.filter((i) => i.severity === "critical").length,
    openWarning: open.filter((i) => i.severity === "warning").length,
    openInfo: open.filter((i) => i.severity === "info").length,
    clientsAffected: new Set(open.map((i) => i.organizationId).filter(Boolean)).size,
  };

  // client dropdowns: every client (so a clean client can still be scanned)
  const allClients = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.isClient, true))
    .orderBy(organizations.name)
    .limit(500);
  const clients = allClients.filter((c) => !!c.name).map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <RadarIcon className="h-6 w-6 text-primary" />
            Books-Health Radar
          </h1>
          <p className="text-muted-foreground">
            Continuous on-prem QC over each client&rsquo;s books — duplicates, round-dollar entries,
            backdating, uncategorized spikes, and reconciliation drift the quarterly sync never sees.
          </p>
        </div>
      </div>

      <StatsStrip stats={stats} />

      <Radar initial={items} clients={clients} />
    </div>
  );
}
