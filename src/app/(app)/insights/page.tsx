import { and, eq, gte, isNull, isNotNull, lte, desc } from "drizzle-orm";
import {
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfWeek,
  addWeeks,
  subWeeks,
  format,
} from "date-fns";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

import { PeriodSelector } from "@/components/insights/period-selector";
import { KpiStrip } from "@/components/insights/kpi-strip";
import { StatusDonut } from "@/components/insights/status-donut";
import { TypeBar } from "@/components/insights/type-bar";
import { ThroughputChart } from "@/components/insights/throughput-chart";
import { CapacityHeatmap } from "@/components/insights/capacity-heatmap";
import { StaffTable } from "@/components/insights/staff-table";
import { ClientTable } from "@/components/insights/client-table";
import {
  isPeriod,
  type Period,
  type Kpi,
  type StatusSlice,
  type TypeBar as TypeBarRow,
  type ThroughputPoint,
  type HeatmapData,
  type StaffRow,
  type ClientRow,
} from "@/components/insights/types";

export const dynamic = "force-dynamic";

function periodRange(period: Period, now: Date): { start: Date; end: Date } {
  switch (period) {
    case "last30":
      return { start: new Date(now.getTime() - 30 * 86400_000), end: now };
    case "quarter":
      return { start: startOfQuarter(now), end: endOfQuarter(now) };
    case "month":
    default:
      return { start: startOfMonth(now), end: endOfMonth(now) };
  }
}

const HEATMAP_WEEKS = 6;
const THROUGHPUT_WEEKS = 8;

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const period: Period = isPeriod(sp.period) ? sp.period : "month";

  const now = new Date();
  const { start: periodStart, end: periodEnd } = periodRange(period, now);
  const weekStartsOn = 1; // Monday

  // Fetch the raw building blocks. Open work items + lookups, then reduce in JS.
  const [
    openItems,
    statuses,
    workTypes,
    users,
    completedItems,
    periodTime,
    allTimeInPeriod,
    activities,
    organizations,
  ] = await Promise.all([
    db
      .select()
      .from(schema.workItems)
      .where(and(isNull(schema.workItems.completedAt), isNull(schema.workItems.deletedAt))),
    db.select().from(schema.workStatuses).orderBy(schema.workStatuses.position),
    db.select().from(schema.workTypes),
    db.select().from(schema.users).where(eq(schema.users.active, true)),
    db
      .select()
      .from(schema.workItems)
      .where(
        and(
          isNull(schema.workItems.deletedAt),
          isNotNull(schema.workItems.completedAt),
          gte(schema.workItems.completedAt, subWeeks(startOfWeek(now, { weekStartsOn }), THROUGHPUT_WEEKS - 1)),
        ),
      ),
    // time entries within the selected period (for KPIs + staff utilization)
    db
      .select()
      .from(schema.timeEntries)
      .where(and(gte(schema.timeEntries.date, periodStart), lte(schema.timeEntries.date, periodEnd))),
    // all time entries in period grouped by org for the client table (same set, reused)
    db
      .select()
      .from(schema.timeEntries)
      .where(and(gte(schema.timeEntries.date, periodStart), lte(schema.timeEntries.date, periodEnd))),
    db.select().from(schema.activities).orderBy(desc(schema.activities.createdAt)).limit(2000),
    db
      .select()
      .from(schema.organizations)
      .where(and(eq(schema.organizations.isClient, true), isNull(schema.organizations.deletedAt))),
  ]);

  const statusById = new Map(statuses.map((s) => [s.id, s]));

  /* ---------------- KPIs ---------------- */
  const overdueCount = openItems.filter(
    (w) => w.dueDate && w.dueDate < now,
  ).length;
  const completedThisPeriod = completedItems.filter(
    (w) => w.completedAt && w.completedAt >= periodStart && w.completedAt <= periodEnd,
  ).length;
  const wipValueCents = openItems.reduce((s, w) => s + (w.budgetAmountCents ?? 0), 0);
  const billableMinutes = periodTime.filter((t) => t.billable).reduce((s, t) => s + t.minutes, 0);
  const totalLoggedMinutes = periodTime.reduce((s, t) => s + t.minutes, 0);
  const realizationPct =
    totalLoggedMinutes > 0 ? Math.round((billableMinutes / totalLoggedMinutes) * 100) : null;

  const kpi: Kpi = {
    openWork: openItems.length,
    overdue: overdueCount,
    completedThisPeriod,
    wipValueCents,
    billableMinutes,
    realizationPct,
  };

  /* ---------------- Work by status (open work, excludes done category) ---------------- */
  const statusCounts = new Map<string, number>();
  for (const w of openItems) {
    if (!w.statusId) continue;
    statusCounts.set(w.statusId, (statusCounts.get(w.statusId) ?? 0) + 1);
  }
  const statusSlices: StatusSlice[] = statuses
    .filter((s) => s.category !== "done" && (statusCounts.get(s.id) ?? 0) > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      color: s.color ?? "",
      count: statusCounts.get(s.id) ?? 0,
    }));

  /* ---------------- Work by type ---------------- */
  const typeAgg = new Map<string, { count: number; budgetCents: number }>();
  for (const w of openItems) {
    if (!w.workTypeId) continue;
    const cur = typeAgg.get(w.workTypeId) ?? { count: 0, budgetCents: 0 };
    cur.count += 1;
    cur.budgetCents += w.budgetAmountCents ?? 0;
    typeAgg.set(w.workTypeId, cur);
  }
  const typeBars: TypeBarRow[] = workTypes
    .map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color ?? "",
      count: typeAgg.get(t.id)?.count ?? 0,
      budgetCents: typeAgg.get(t.id)?.budgetCents ?? 0,
    }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  /* ---------------- Throughput (completed per week, last 8 weeks) ---------------- */
  const tpWeeks: ThroughputPoint[] = [];
  const thisWeekStart = startOfWeek(now, { weekStartsOn });
  for (let i = THROUGHPUT_WEEKS - 1; i >= 0; i--) {
    const ws = subWeeks(thisWeekStart, i);
    tpWeeks.push({ weekStart: ws.toISOString(), label: format(ws, "MMM d"), completed: 0 });
  }
  const tpIndex = new Map(tpWeeks.map((p, i) => [p.weekStart, i]));
  for (const w of completedItems) {
    if (!w.completedAt) continue;
    const ws = startOfWeek(w.completedAt, { weekStartsOn }).toISOString();
    const idx = tpIndex.get(ws);
    if (idx != null) tpWeeks[idx].completed += 1;
  }

  /* ---------------- Capacity heatmap (next 6 weeks) ---------------- */
  const heatWeeks: { weekStart: string; label: string; start: Date; end: Date }[] = [];
  for (let i = 0; i < HEATMAP_WEEKS; i++) {
    const start = addWeeks(thisWeekStart, i);
    const end = addWeeks(start, 1);
    heatWeeks.push({
      weekStart: start.toISOString(),
      label: i === 0 ? "This wk" : format(start, "MMM d"),
      start,
      end,
    });
  }
  // load[userId][weekIdx] = { minutes, items }
  const heatLoad = new Map<string, { minutes: number; items: number }[]>();
  for (const u of users) {
    heatLoad.set(
      u.id,
      heatWeeks.map(() => ({ minutes: 0, items: 0 })),
    );
  }
  for (const w of openItems) {
    if (!w.assigneeId || !w.dueDate) continue;
    const lane = heatLoad.get(w.assigneeId);
    if (!lane) continue;
    for (let i = 0; i < heatWeeks.length; i++) {
      if (w.dueDate >= heatWeeks[i].start && w.dueDate < heatWeeks[i].end) {
        lane[i].minutes += w.budgetMinutes ?? 0;
        lane[i].items += 1;
        break;
      }
    }
  }
  const heatmap: HeatmapData = {
    weeks: heatWeeks.map((w) => ({ weekStart: w.weekStart, label: w.label })),
    rows: users
      .map((u) => {
        const lane = heatLoad.get(u.id) ?? [];
        const cells = heatWeeks.map((w, i) => {
          const cap = u.weeklyCapacityMinutes || 0;
          const load = lane[i]?.minutes ?? 0;
          return {
            weekStart: w.weekStart,
            loadMinutes: load,
            capacityMinutes: cap,
            ratio: cap > 0 ? load / cap : 0,
            items: lane[i]?.items ?? 0,
          };
        });
        const totalLoad = cells.reduce((s, c) => s + c.loadMinutes, 0);
        return {
          userId: u.id,
          name: u.name,
          image: u.image,
          color: u.color,
          capacityMinutes: u.weeklyCapacityMinutes,
          cells,
          _totalLoad: totalLoad,
        };
      })
      .filter((r) => r._totalLoad > 0)
      .sort((a, b) => b._totalLoad - a._totalLoad)
      .map(({ _totalLoad, ...r }) => r),
  };

  /* ---------------- Per-staff table ---------------- */
  const loggedByUser = new Map<string, number>();
  for (const t of periodTime) {
    loggedByUser.set(t.userId, (loggedByUser.get(t.userId) ?? 0) + t.minutes);
  }
  const openByUser = new Map<string, number>();
  const overdueByUser = new Map<string, number>();
  for (const w of openItems) {
    if (!w.assigneeId) continue;
    openByUser.set(w.assigneeId, (openByUser.get(w.assigneeId) ?? 0) + 1);
    if (w.dueDate && w.dueDate < now) {
      overdueByUser.set(w.assigneeId, (overdueByUser.get(w.assigneeId) ?? 0) + 1);
    }
  }
  const completedByUser = new Map<string, number>();
  for (const w of completedItems) {
    if (!w.assigneeId || !w.completedAt) continue;
    if (w.completedAt >= periodStart && w.completedAt <= periodEnd) {
      completedByUser.set(w.assigneeId, (completedByUser.get(w.assigneeId) ?? 0) + 1);
    }
  }
  // capacity scaled to the selected period length (in weeks) for a fair utilization comparison
  const periodWeeks = Math.max(
    1,
    (periodEnd.getTime() - periodStart.getTime()) / (7 * 86400_000),
  );
  const staffRows: StaffRow[] = users
    .map((u) => {
      const logged = loggedByUser.get(u.id) ?? 0;
      const periodCapacity = u.weeklyCapacityMinutes * periodWeeks;
      return {
        userId: u.id,
        name: u.name,
        image: u.image,
        color: u.color,
        open: openByUser.get(u.id) ?? 0,
        overdue: overdueByUser.get(u.id) ?? 0,
        completedThisPeriod: completedByUser.get(u.id) ?? 0,
        loggedMinutes: logged,
        capacityMinutes: Math.round(periodCapacity),
        utilizationPct: periodCapacity > 0 ? Math.round((logged / periodCapacity) * 100) : null,
      };
    })
    .sort((a, b) => b.open + b.loggedMinutes / 600 - (a.open + a.loggedMinutes / 600));

  /* ---------------- Per-client table ---------------- */
  const openByOrg = new Map<string, number>();
  const wipByOrg = new Map<string, number>();
  for (const w of openItems) {
    if (!w.organizationId) continue;
    openByOrg.set(w.organizationId, (openByOrg.get(w.organizationId) ?? 0) + 1);
    wipByOrg.set(w.organizationId, (wipByOrg.get(w.organizationId) ?? 0) + (w.budgetAmountCents ?? 0));
  }
  const loggedByOrg = new Map<string, number>();
  for (const t of allTimeInPeriod) {
    if (!t.organizationId) continue;
    loggedByOrg.set(t.organizationId, (loggedByOrg.get(t.organizationId) ?? 0) + t.minutes);
  }
  const lastActivityByOrg = new Map<string, number>();
  for (const a of activities) {
    if (a.entityKind !== "organization") continue;
    const ms = new Date(a.createdAt).getTime();
    const prev = lastActivityByOrg.get(a.entityId) ?? 0;
    if (ms > prev) lastActivityByOrg.set(a.entityId, ms);
  }
  const clientRows: ClientRow[] = organizations
    .map((o) => ({
      orgId: o.id,
      name: o.name,
      openWork: openByOrg.get(o.id) ?? 0,
      wipValueCents: wipByOrg.get(o.id) ?? 0,
      loggedMinutes: loggedByOrg.get(o.id) ?? 0,
      lastActivityAt: lastActivityByOrg.get(o.id) ?? null,
    }))
    .filter((c) => c.openWork > 0 || c.loggedMinutes > 0 || c.wipValueCents > 0)
    .sort((a, b) => b.wipValueCents - a.wipValueCents || b.openWork - a.openWork)
    .slice(0, 50);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BarChart3 className="h-6 w-6 text-primary" />
            Insights
          </h1>
          <p className="text-muted-foreground">
            Firm-wide analytics, throughput, and capacity planning.
          </p>
        </div>
        <PeriodSelector period={period} />
      </div>

      <KpiStrip kpi={kpi} period={period} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Open work by status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusDonut data={statusSlices} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Throughput · completed per week</CardTitle>
          </CardHeader>
          <CardContent>
            <ThroughputChart data={tpWeeks} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Open work by type</CardTitle>
        </CardHeader>
        <CardContent>
          <TypeBar data={typeBars} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capacity &amp; workload</CardTitle>
          <p className="text-sm text-muted-foreground">
            Assigned budget vs weekly capacity for the next {HEATMAP_WEEKS} weeks, by due date.
          </p>
        </CardHeader>
        <CardContent>
          <CapacityHeatmap data={heatmap} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <StaffTable rows={staffRows} period={period} />
        <ClientTable rows={clientRows} />
      </div>
    </div>
  );
}
