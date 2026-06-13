"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, Square, X, Timer as TimerIcon, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { startTimer, stopTimer, cancelTimer } from "@/app/(app)/time/actions";
import { WorkItemPicker } from "./work-item-picker";
import type { RunningTimer, WorkItemOption } from "./types";

function hhmmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** Sticky live-timer bar shown above all tabs. */
export function TimerBar({
  running,
  workItems,
}: {
  running: RunningTimer | null;
  workItems: WorkItemOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  // Local form state for starting a new timer.
  const [workItemId, setWorkItemId] = React.useState<string | null>(null);
  const [description, setDescription] = React.useState("");
  const [billable, setBillable] = React.useState(true);

  // Ticking elapsed seconds for the running timer.
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

  // Keep the document title alive with the running clock.
  React.useEffect(() => {
    if (!running) return;
    const prev = document.title;
    document.title = `⏱ ${hhmmss(elapsed)} — KarbonCopy`;
    return () => {
      document.title = prev;
    };
  }, [running, elapsed]);

  function onStart() {
    if (!workItemId) {
      toast.error("Pick a work item to track against.");
      return;
    }
    const fd = new FormData();
    fd.set("workItemId", workItemId);
    if (description) fd.set("description", description);
    fd.set("billable", billable ? "true" : "false");
    startTransition(async () => {
      const res = await startTimer(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Timer started");
      setDescription("");
      router.refresh();
    });
  }

  function onStop() {
    if (!running) return;
    startTransition(async () => {
      const res = await stopTimer(running.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Time logged");
      router.refresh();
    });
  }

  function onCancel() {
    if (!running) return;
    startTransition(async () => {
      const res = await cancelTimer(running.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.message("Timer discarded");
      router.refresh();
    });
  }

  if (running) {
    return (
      <div className="sticky top-0 z-30 -mx-1 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-primary/10">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <div className="font-mono text-2xl font-bold tabular-nums tracking-tight">
            {hhmmss(elapsed)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {running.workTitle ?? "Untitled work"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {[running.clientName, running.description].filter(Boolean).join(" · ") ||
                "Tracking now"}
            </div>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              running.billable
                ? "bg-success/15 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            {running.billable ? "Billable" : "Non-billable"}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onStop} disabled={pending}>
              <Square className="h-4 w-4 fill-current" /> Stop
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={onCancel}
              disabled={pending}
              aria-label="Discard timer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Idle: quick-start composer.
  return (
    <div className="sticky top-0 z-30 -mx-1 rounded-xl border bg-card/80 px-4 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <TimerIcon className="h-4 w-4" />
        </div>
        <div className="min-w-[200px] flex-1">
          <WorkItemPicker
            workItems={workItems}
            value={workItemId}
            onChange={setWorkItemId}
            placeholder="What are you working on?"
          />
        </div>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a note (optional)"
          className="min-w-[160px] flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") onStart();
          }}
        />
        <div className="flex items-center gap-2">
          <Label
            htmlFor="timer-billable"
            className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
          >
            <DollarSign className="h-3.5 w-3.5" /> Billable
          </Label>
          <Switch id="timer-billable" checked={billable} onCheckedChange={setBillable} />
        </div>
        <Button onClick={onStart} disabled={pending}>
          <Play className="h-4 w-4 fill-current" /> Start
        </Button>
      </div>
    </div>
  );
}
