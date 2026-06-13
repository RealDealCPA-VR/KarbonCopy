"use client";

import * as React from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DeadlineRow } from "@/app/(app)/deadlines/data";
import type { DeadlineStatus } from "@/db/schema";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function effectiveDue(d: DeadlineRow): number {
  return d.extendedDueDate ?? d.dueDate;
}

function pillClass(status: DeadlineStatus, overdue: boolean): string {
  if (status === "filed") return "bg-success/10 text-success line-through";
  if (status === "na") return "bg-muted text-muted-foreground line-through";
  if (status === "missed" || overdue) return "bg-destructive/10 text-destructive";
  if (status === "extended") return "bg-warning/10 text-warning";
  return "bg-primary/10 text-primary hover:bg-primary/20";
}

export function DeadlineCalendar({ deadlines }: { deadlines: DeadlineRow[] }) {
  const [month, setMonth] = React.useState(() => startOfMonth(new Date()));

  const days = React.useMemo(() => {
    const start = startOfWeek(startOfMonth(month));
    const end = endOfWeek(endOfMonth(month));
    return eachDayOfInterval({ start, end });
  }, [month]);

  const byDay = React.useMemo(() => {
    const m = new Map<string, DeadlineRow[]>();
    for (const d of deadlines) {
      const key = format(new Date(effectiveDue(d)), "yyyy-MM-dd");
      const arr = m.get(key) ?? [];
      arr.push(d);
      m.set(key, arr);
    }
    return m;
  }, [deadlines]);

  const now = Date.now();

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-lg font-semibold">{format(month, "MMMM yyyy")}</h3>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMonth((m) => addMonths(m, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayItems = byDay.get(key) ?? [];
          const inMonth = isSameMonth(day, month);
          return (
            <div
              key={key}
              className={cn(
                "min-h-[7rem] border-b border-r p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-muted/30",
              )}
            >
              <div
                className={cn(
                  "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs",
                  isToday(day)
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-muted-foreground",
                  !inMonth && "opacity-50",
                )}
              >
                {format(day, "d")}
              </div>
              <div className="space-y-1">
                {dayItems.slice(0, 4).map((d) => {
                  const due = effectiveDue(d);
                  const overdue =
                    (d.status === "upcoming" || d.status === "in_progress" || d.status === "extended") &&
                    due < now;
                  const node = (
                    <div
                      className={cn(
                        "truncate rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors",
                        pillClass(d.status, overdue),
                      )}
                      title={`${d.name}${d.orgName ? ` — ${d.orgName}` : ""}`}
                    >
                      {d.form ?? d.name}
                      {d.orgName ? ` · ${d.orgName}` : ""}
                    </div>
                  );
                  return d.workItemId ? (
                    <a key={d.id} href={`/work/${d.workItemId}`}>
                      {node}
                    </a>
                  ) : (
                    <div key={d.id}>{node}</div>
                  );
                })}
                {dayItems.length > 4 && (
                  <div className="px-1.5 text-[10px] text-muted-foreground">
                    +{dayItems.length - 4} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
