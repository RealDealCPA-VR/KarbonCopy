"use client";
import * as React from "react";
import Link from "next/link";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { AssigneeAvatar, DueBadge, PriorityDot } from "./work-bits";
import type { WorkItemRow, WorkUser } from "./types";

export function BoardCard({
  item,
  assignee,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  item: WorkItemRow;
  assignee?: WorkUser | null;
  dragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}) {
  const completed = !!item.completedAt;
  const progress =
    item.taskTotal > 0 ? Math.round((item.taskDone / item.taskTotal) * 100) : 0;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative cursor-grab rounded-xl border bg-card p-3 shadow-sm transition-all hover:shadow-md active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <GripVertical className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/40" />
      <div className="flex items-start gap-2">
        <PriorityDot priority={item.priority} />
        <Link
          href={`/work/${item.id}`}
          className="min-w-0 flex-1 pr-4 text-sm font-medium leading-snug hover:underline"
        >
          {item.title}
        </Link>
      </div>

      {item.orgName && (
        <div className="mt-1.5 truncate text-xs text-muted-foreground">{item.orgName}</div>
      )}

      {item.taskTotal > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn("h-full rounded-full transition-all", completed ? "bg-success" : "bg-primary")}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {item.taskDone}/{item.taskTotal}
          </span>
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {item.workTypeName && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: (item.workTypeColor || "#6366f1") + "22",
                color: item.workTypeColor || "#6366f1",
              }}
            >
              {item.workTypeName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DueBadge due={item.dueDate} completed={completed} />
          <AssigneeAvatar user={assignee} size={22} />
        </div>
      </div>
    </div>
  );
}
