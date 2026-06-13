"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { moveWorkItem } from "@/app/(app)/work/actions";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { BoardCard } from "./board-card";
import { StatusDot } from "./work-bits";
import type { WorkItemRow, WorkStatus, WorkUser } from "./types";

export function Board({
  statuses,
  items,
  users,
  onAddInStatus,
}: {
  statuses: WorkStatus[];
  items: WorkItemRow[];
  users: WorkUser[];
  onAddInStatus: (statusId: string) => void;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = React.useState<WorkItemRow[]>(items);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [overStatus, setOverStatus] = React.useState<string | null>(null);

  // Keep local state in sync when the server data changes.
  React.useEffect(() => setOptimistic(items), [items]);

  // Live refresh when anyone changes work elsewhere. Firm-wide edits can fire a
  // burst of "work_updated" events, and each refresh re-runs the full board
  // query for every connected user. Debounce (trailing ~1500ms) and skip work
  // when the tab is hidden — background tabs don't need to stay live.
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);
  useRealtimeEvent("work_updated", () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, 1500);
  });

  const userById = React.useMemo(() => {
    const m = new Map<string, WorkUser>();
    users.forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, WorkItemRow[]>();
    for (const s of statuses) map.set(s.id, []);
    const orphan: WorkItemRow[] = [];
    for (const it of optimistic) {
      const arr = it.statusId && map.has(it.statusId) ? map.get(it.statusId)! : orphan;
      arr.push(it);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.boardPosition - b.boardPosition);
    return map;
  }, [optimistic, statuses]);

  function handleDrop(toStatusId: string) {
    const id = draggingId;
    setDraggingId(null);
    setOverStatus(null);
    if (!id) return;
    const item = optimistic.find((i) => i.id === id);
    if (!item || item.statusId === toStatusId) return;

    const target = statuses.find((s) => s.id === toStatusId);
    const movingToDone = target?.category === "done";
    // Position after the last card in the target column.
    const colItems = grouped.get(toStatusId) ?? [];
    const newPos = colItems.length ? Math.max(...colItems.map((c) => c.boardPosition)) + 1 : 1;

    // Optimistic update.
    setOptimistic((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              statusId: toStatusId,
              boardPosition: newPos,
              completedAt: movingToDone ? i.completedAt ?? new Date() : null,
            }
          : i,
      ),
    );

    moveWorkItem({ id, toStatusId, position: newPos })
      .then(() => {
        if (movingToDone) toast.success(`Completed "${item.title}"`);
      })
      .catch(() => {
        toast.error("Couldn't move that card");
        setOptimistic(items); // rollback
        router.refresh();
      });
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {statuses.map((status) => {
        const colItems = grouped.get(status.id) ?? [];
        const isOver = overStatus === status.id;
        return (
          <div
            key={status.id}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30 transition-colors",
              isOver && "border-primary/60 bg-primary/5 ring-2 ring-primary/20",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              if (overStatus !== status.id) setOverStatus(status.id);
            }}
            onDragLeave={(e) => {
              // Only clear when leaving the column entirely.
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStatus(null);
            }}
            onDrop={() => handleDrop(status.id)}
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <StatusDot color={status.color} />
                <span className="text-sm font-semibold">{status.name}</span>
                <span className="rounded-full bg-background px-1.5 text-xs tabular-nums text-muted-foreground">
                  {colItems.length}
                </span>
              </div>
              <button
                onClick={() => onAddInStatus(status.id)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                title="Add work here"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {colItems.length === 0 ? (
                <div
                  className={cn(
                    "m-1 flex flex-1 items-center justify-center rounded-lg border border-dashed py-10 text-center text-xs text-muted-foreground",
                    isOver && "border-primary/50 text-primary",
                  )}
                >
                  {isOver ? "Drop here" : "No work"}
                </div>
              ) : (
                colItems.map((item) => (
                  <BoardCard
                    key={item.id}
                    item={item}
                    assignee={item.assigneeId ? userById.get(item.assigneeId) : null}
                    dragging={draggingId === item.id}
                    onDragStart={() => setDraggingId(item.id)}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setOverStatus(null);
                    }}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
