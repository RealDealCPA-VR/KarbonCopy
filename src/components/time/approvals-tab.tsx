"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { CheckCircle2, ClipboardCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn, formatMinutes, formatMoneyCents, initials } from "@/lib/utils";
import { approveTimeEntries } from "@/app/(app)/time/actions";
import type { ApprovalGroup } from "./types";

export function ApprovalsTab({
  groups,
  defaultRateCents,
}: {
  groups: ApprovalGroup[];
  defaultRateCents: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, startTransition] = React.useTransition();

  const allIds = React.useMemo(
    () => groups.flatMap((g) => g.entries.map((e) => e.id)),
    [groups],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleGroup(g: ApprovalGroup, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of g.entries) on ? next.add(e.id) : next.delete(e.id);
      return next;
    });
  }

  function approve(ids: string[]) {
    if (!ids.length) return;
    startTransition(async () => {
      const res = await approveTimeEntries(ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Approved ${res.data?.count ?? ids.length} ${(res.data?.count ?? 0) === 1 ? "entry" : "entries"}`);
      setSelected(new Set());
      router.refresh();
    });
  }

  if (groups.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10 text-success">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <div>
            <p className="font-semibold">All caught up</p>
            <p className="text-sm text-muted-foreground">
              There are no time entries waiting for approval.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalPending = allIds.length;

  return (
    <div className="space-y-4">
      {/* Bulk bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{totalPending}</span>
          <span className="text-muted-foreground">entries awaiting approval</span>
          {selected.size > 0 && (
            <Badge variant="secondary" className="ml-1">{selected.size} selected</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending || selected.size === 0}
            onClick={() => approve(Array.from(selected))}
          >
            Approve selected
          </Button>
          <Button size="sm" disabled={pending} onClick={() => approve(allIds)}>
            <CheckCircle2 className="h-4 w-4" /> Approve all
          </Button>
        </div>
      </div>

      {groups.map((g) => {
        const groupIds = g.entries.map((e) => e.id);
        const allChecked = groupIds.every((id) => selected.has(id));
        const someChecked = groupIds.some((id) => selected.has(id));
        const totalMinutes = g.entries.reduce((s, e) => s + e.minutes, 0);
        const billableCents = g.entries.reduce(
          (s, e) => s + (e.billable ? e.minutes * (e.rateCents ?? defaultRateCents) : 0),
          0,
        );
        return (
          <Card key={g.userId}>
            <CardContent className="p-0">
              <div className="flex items-center gap-3 border-b px-5 py-3">
                <Checkbox
                  checked={allChecked ? true : someChecked ? "indeterminate" : false}
                  onCheckedChange={(v) => toggleGroup(g, v === true)}
                  aria-label={`Select all entries for ${g.userName}`}
                />
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: g.userColor ?? "#64748b" }}
                >
                  {initials(g.userName)}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{g.userName}</div>
                  <div className="text-xs text-muted-foreground">
                    {g.entries.length} {g.entries.length === 1 ? "entry" : "entries"} ·{" "}
                    {formatMinutes(totalMinutes)} · {formatMoneyCents(billableCents)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => approve(groupIds)}
                >
                  Approve all
                </Button>
              </div>
              <ul className="divide-y">
                {g.entries.map((e) => (
                  <li
                    key={e.id}
                    className={cn(
                      "flex items-center gap-3 px-5 py-3 transition-colors",
                      selected.has(e.id) && "bg-primary/5",
                    )}
                  >
                    <Checkbox
                      checked={selected.has(e.id)}
                      onCheckedChange={() => toggle(e.id)}
                      aria-label="Select entry"
                    />
                    <div className="w-20 shrink-0 text-xs text-muted-foreground">
                      {format(new Date(e.date), "EEE, MMM d")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {e.workTitle ?? "No work item"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[e.clientName, e.description].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        e.billable ? "bg-success" : "bg-muted-foreground/40",
                      )}
                      title={e.billable ? "Billable" : "Non-billable"}
                    />
                    <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                      {formatMinutes(e.minutes)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
