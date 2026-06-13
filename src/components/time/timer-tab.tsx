"use client";

import * as React from "react";
import { isSameDay } from "date-fns";
import { Timer as TimerIcon, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatMinutes } from "@/lib/utils";
import type { RunningTimer, TimeEntryRow, WorkItemOption } from "./types";

function hhmmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/**
 * Dedicated Timer tab — a large live read-out of the running timer plus
 * today's running total. Starting/stopping is driven by the sticky TimerBar
 * above (single source of truth for one-running-timer-per-user).
 */
export function TimerTab({
  running,
  todayEntries,
  currentUserName,
}: {
  running: RunningTimer | null;
  workItems: WorkItemOption[];
  todayEntries: TimeEntryRow[];
  currentUserName: string;
}) {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!running?.startedAt) return;
    const base = running.minutes * 60;
    const compute = () =>
      setElapsed(base + Math.max(0, (Date.now() - (running.startedAt as number)) / 1000));
    compute();
    const t = setInterval(compute, 1000);
    return () => clearInterval(t);
  }, [running?.startedAt, running?.minutes]);

  const loggedToday = todayEntries
    .filter((e) => isSameDay(new Date(e.date), new Date()))
    .reduce((s, e) => s + e.minutes, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col items-center justify-center gap-4 py-14">
          {running ? (
            <>
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
              </span>
              <div className="font-mono text-6xl font-bold tabular-nums tracking-tight sm:text-7xl">
                {hhmmss(elapsed)}
              </div>
              <div className="text-center">
                <div className="text-lg font-medium">{running.workTitle ?? "Untitled work"}</div>
                <div className="text-sm text-muted-foreground">
                  {[running.clientName, running.description].filter(Boolean).join(" · ") ||
                    "Tracking now"}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Stop or discard from the bar at the top of the page.
              </p>
            </>
          ) : (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <TimerIcon className="h-8 w-8" />
              </div>
              <div className="font-mono text-6xl font-bold tabular-nums tracking-tight text-muted-foreground/60 sm:text-7xl">
                00:00:00
              </div>
              <div className="text-center">
                <div className="text-lg font-medium">No timer running</div>
                <div className="text-sm text-muted-foreground">
                  Pick a work item in the bar above and hit Start, {currentUserName.split(" ")[0]}.
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{formatMinutes(loggedToday)}</div>
              <div className="text-sm text-muted-foreground">Logged today</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="text-sm font-medium text-muted-foreground">How the timer works</div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="text-primary">1.</span> Choose a work item and start the timer in
                the bar above.
              </li>
              <li className="flex gap-2">
                <span className="text-primary">2.</span> Starting a new timer automatically stops
                any other running one.
              </li>
              <li className="flex gap-2">
                <span className="text-primary">3.</span> Stopping rounds the elapsed time to whole
                minutes and saves it to your timesheet.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
