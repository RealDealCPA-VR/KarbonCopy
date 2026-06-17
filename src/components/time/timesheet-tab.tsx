"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addWeeks,
  format,
  isSameDay,
  startOfWeek,
} from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  Tooltip as RTooltip,
} from "recharts";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatMinutes, formatMoneyCents } from "@/lib/utils";
import { EntryDialog } from "./entry-dialog";
import { deleteTimeEntry } from "@/app/(app)/time/actions";
import type { TimeEntryRow, WorkItemOption } from "./types";

const DAY_MS = 86400_000;

export function TimesheetTab({
  weekStartMs,
  entries,
  workItems,
  defaultRateCents,
}: {
  weekStartMs: number;
  entries: TimeEntryRow[];
  workItems: WorkItemOption[];
  defaultRateCents: number;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TimeEntryRow | null>(null);
  const [activeDayMs, setActiveDayMs] = React.useState(weekStartMs);
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);

  const weekStart = React.useMemo(() => new Date(weekStartMs), [weekStartMs]);
  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStartMs + i * DAY_MS)),
    [weekStartMs],
  );

  // Totals.
  const totals = React.useMemo(() => {
    let total = 0;
    let billable = 0;
    let amount = 0;
    for (const e of entries) {
      total += e.minutes;
      if (e.billable) {
        billable += e.minutes;
        amount += (e.minutes / 60) * (e.rateCents ?? defaultRateCents);
      }
    }
    return { total, billable, nonBillable: total - billable, amountCents: Math.round(amount) };
  }, [entries, defaultRateCents]);

  // Daily aggregation for chart + grouping.
  const perDay = React.useMemo(() => {
    return days.map((d) => {
      const dayEntries = entries
        .filter((e) => isSameDay(new Date(e.date), d))
        .sort((a, b) => b.minutes - a.minutes);
      const minutes = dayEntries.reduce((s, e) => s + e.minutes, 0);
      return { date: d, minutes, hours: +(minutes / 60).toFixed(2), entries: dayEntries };
    });
  }, [days, entries]);

  function goWeek(delta: number) {
    const next = startOfWeek(addWeeks(weekStart, delta), { weekStartsOn: 1 });
    router.push(`/time?tab=timesheet&week=${next.toISOString()}`);
  }
  function goThisWeek() {
    const next = startOfWeek(new Date(), { weekStartsOn: 1 });
    router.push(`/time?tab=timesheet&week=${next.toISOString()}`);
  }

  function openNew(dayMs?: number) {
    setEditing(null);
    setActiveDayMs(dayMs ?? Date.now());
    setDialogOpen(true);
  }
  function openEdit(e: TimeEntryRow) {
    setEditing(e);
    setDialogOpen(true);
  }
  async function onDelete(id: string) {
    setPendingDelete(id);
    const res = await deleteTimeEntry(id);
    setPendingDelete(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Entry deleted");
    router.refresh();
  }

  const weekEnd = new Date(weekStartMs + 6 * DAY_MS);
  const isCurrentWeek = isSameDay(
    weekStart,
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border p-0.5">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goWeek(-1)} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goWeek(1)} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
            </div>
          </div>
          {!isCurrentWeek && (
            <Button variant="outline" size="sm" onClick={goThisWeek}>
              This week
            </Button>
          )}
        </div>
        <Button onClick={() => openNew()}>
          <Plus className="h-4 w-4" /> Log time
        </Button>
      </div>

      {/* Summary + chart */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="grid grid-cols-3 gap-2 p-5">
            <Stat label="Total" value={formatMinutes(totals.total)} tone="default" />
            <Stat label="Billable" value={formatMinutes(totals.billable)} tone="success" />
            <Stat label="Non-bill." value={formatMinutes(totals.nonBillable)} tone="muted" />
            <div className="col-span-3 mt-2 border-t pt-3">
              <div className="text-xs text-muted-foreground">Billable value</div>
              <div className="text-xl font-bold tabular-nums">
                {formatMoneyCents(totals.amountCents)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="mb-2 text-sm font-medium text-muted-foreground">Hours by day</div>
            {totals.total === 0 ? (
              <div className="flex h-[140px] items-center justify-center text-sm text-muted-foreground">
                No time logged this week yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={perDay} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <XAxis
                    dataKey={(d) => format(d.date, "EEE")}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    allowDecimals={false}
                  />
                  <RTooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "hsl(var(--popover-foreground))",
                    }}
                    formatter={(v: number) => [formatMinutes(Math.round(v * 60)), "Logged"]}
                    labelFormatter={(_, p) =>
                      p?.[0] ? format((p[0].payload as { date: Date }).date, "EEE, MMM d") : ""
                    }
                  />
                  <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={42}>
                    {perDay.map((d) => (
                      <Cell
                        key={d.date.toISOString()}
                        fill={
                          isSameDay(d.date, new Date())
                            ? "hsl(var(--primary))"
                            : "hsl(var(--primary) / 0.45)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Day groups */}
      {totals.total === 0 ? (
        <EmptyState onCreate={() => openNew()} />
      ) : (
        <div className="space-y-4">
          {perDay
            .filter((d) => d.entries.length > 0)
            .map((d) => (
              <Card key={d.date.toISOString()}>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between border-b px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex h-9 w-9 flex-col items-center justify-center rounded-lg text-xs font-medium",
                          isSameDay(d.date, new Date())
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        <span className="text-[10px] uppercase leading-none">{format(d.date, "EEE")}</span>
                        <span className="text-sm font-bold leading-tight">{format(d.date, "d")}</span>
                      </div>
                      <div className="font-medium">{format(d.date, "EEEE")}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums">{formatMinutes(d.minutes)}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openNew(d.date.getTime())} aria-label="Add entry to day">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <ul className="divide-y">
                    {d.entries.map((e) => (
                      <li key={e.id} className="group flex items-center gap-3 px-5 py-3">
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            e.billable ? "bg-success" : "bg-muted-foreground/40",
                          )}
                          title={e.billable ? "Billable" : "Non-billable"}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {e.workTitle ?? "No work item"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[e.clientName, e.description].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                        {e.approved && (
                          <Badge variant="secondary" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Approved
                          </Badge>
                        )}
                        <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                          {formatMinutes(e.minutes)}
                        </span>
                        <div className="flex w-16 shrink-0 items-center justify-end gap-1">
                          {e.approved ? (
                            <span className="text-muted-foreground" title="Approved entries are locked">
                              <Lock className="h-3.5 w-3.5" />
                            </span>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                                onClick={() => openEdit(e)}
                                aria-label="Edit entry"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                                onClick={() => onDelete(e.id)}
                                disabled={pendingDelete === e.id}
                                aria-label="Delete entry"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      <EntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editing}
        workItems={workItems}
        defaultDateMs={activeDayMs}
        defaultRateCents={defaultRateCents}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "default" | "success" | "muted";
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-lg font-bold tabular-nums",
          tone === "success" && "text-success",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <CalendarDays className="h-7 w-7" />
        </div>
        <div>
          <p className="font-semibold">No time logged this week</p>
          <p className="text-sm text-muted-foreground">
            Start the timer above or add an entry manually.
          </p>
        </div>
        <Button onClick={onCreate} className="mt-1">
          <Plus className="h-4 w-4" /> Log time
        </Button>
      </CardContent>
    </Card>
  );
}
