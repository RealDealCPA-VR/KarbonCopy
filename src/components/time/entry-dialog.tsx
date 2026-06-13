"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { WorkItemPicker } from "./work-item-picker";
import { upsertTimeEntry } from "@/app/(app)/time/actions";
import type { TimeEntryRow, WorkItemOption } from "./types";

function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function EntryDialog({
  open,
  onOpenChange,
  entry,
  workItems,
  defaultDateMs,
  defaultRateCents,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entry?: TimeEntryRow | null;
  workItems: WorkItemOption[];
  defaultDateMs: number;
  defaultRateCents: number;
}) {
  const router = useRouter();
  const editing = Boolean(entry?.id);
  const [pending, setPending] = React.useState(false);

  const [workItemId, setWorkItemId] = React.useState<string | null>(entry?.workItemId ?? null);
  const [billable, setBillable] = React.useState(entry?.billable ?? true);
  const [date, setDate] = React.useState(toDateInput(entry?.date ?? defaultDateMs));
  const [hours, setHours] = React.useState(entry ? String(Math.floor(entry.minutes / 60)) : "");
  const [minutes, setMinutes] = React.useState(entry ? String(entry.minutes % 60) : "");
  const [rate, setRate] = React.useState(
    entry?.rateCents != null ? String(entry.rateCents / 100) : "",
  );

  React.useEffect(() => {
    if (!open) return;
    setWorkItemId(entry?.workItemId ?? null);
    setBillable(entry?.billable ?? true);
    setDate(toDateInput(entry?.date ?? defaultDateMs));
    setHours(entry ? String(Math.floor(entry.minutes / 60)) : "");
    setMinutes(entry ? String(entry.minutes % 60) : "");
    setRate(entry?.rateCents != null ? String(entry.rateCents / 100) : "");
  }, [open, entry, defaultDateMs]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (editing && entry) fd.set("id", entry.id);
    fd.set("workItemId", workItemId ?? "");
    fd.set("billable", billable ? "true" : "false");
    fd.set("date", date);
    fd.set("hours", hours || "0");
    fd.set("minutes", minutes || "0");
    const rateNum = rate.trim() === "" ? null : Math.round(Number(rate) * 100);
    if (rateNum != null && Number.isFinite(rateNum)) fd.set("rateCents", String(rateNum));
    else fd.delete("rateCents");

    setPending(true);
    const res = await upsertTimeEntry(fd);
    setPending(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(editing ? "Entry updated" : "Time logged");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit time entry" : "Log time"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the details of this time entry."
              : "Record time you spent on a client engagement."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Work item</Label>
            <WorkItemPicker workItems={workItems} value={workItemId} onChange={setWorkItemId} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={entry?.description ?? ""}
              rows={2}
              placeholder="What did you work on?"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="0"
                  className="text-right"
                  aria-label="Hours"
                />
                <span className="text-sm text-muted-foreground">h</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  placeholder="0"
                  className="text-right"
                  aria-label="Minutes"
                />
                <span className="text-sm text-muted-foreground">m</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="rate">Rate ($/hr)</Label>
              <Input
                id="rate"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder={`Default ${defaultRateCents / 100}`}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <Label htmlFor="billable" className="cursor-pointer">
                Billable
              </Label>
              <Switch id="billable" checked={billable} onCheckedChange={setBillable} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save changes" : "Log time"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
