"use client";
import * as React from "react";
import { isToday, isTomorrow, format, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { cn, colorForId, initials } from "@/lib/utils";
import type { WorkPriority } from "@/db/schema";
import type { WorkUser } from "./types";

export function AssigneeAvatar({
  user,
  size = 24,
  className,
}: {
  user?: WorkUser | null;
  size?: number;
  className?: string;
}) {
  if (!user) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-[10px] text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size }}
        title="Unassigned"
      >
        ?
      </span>
    );
  }
  const bg = user.color || colorForId(user.id);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        className,
      )}
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.42 }}
      title={user.name}
    >
      {initials(user.name)}
    </span>
  );
}

/** Due-date badge: red if overdue, amber if today/tomorrow/soon, muted otherwise. */
export function DueBadge({
  due,
  completed,
  className,
}: {
  due: Date | number | null | undefined;
  completed?: boolean;
  className?: string;
}) {
  if (!due) return null;
  const d = new Date(due);
  const now = new Date();
  const overdue = !completed && d < now;
  const soon = !completed && !overdue && (isToday(d) || isTomorrow(d) || d.getTime() - now.getTime() < 3 * 86400_000);

  let label: string;
  if (overdue) label = `Overdue ${formatDistanceToNow(d, { addSuffix: true })}`;
  else if (isToday(d)) label = "Due today";
  else if (isTomorrow(d)) label = "Due tomorrow";
  else label = format(d, "MMM d");

  return (
    <Badge
      variant={completed ? "secondary" : overdue ? "destructive" : soon ? "warning" : "outline"}
      className={cn("font-medium", className)}
    >
      {label}
    </Badge>
  );
}

const PRIORITY_STYLES: Record<WorkPriority, { dot: string; label: string }> = {
  urgent: { dot: "bg-destructive", label: "Urgent" },
  high: { dot: "bg-warning", label: "High" },
  normal: { dot: "bg-muted-foreground/40", label: "Normal" },
  low: { dot: "bg-muted-foreground/20", label: "Low" },
};

export function PriorityDot({ priority, withLabel }: { priority: WorkPriority; withLabel?: boolean }) {
  const s = PRIORITY_STYLES[priority];
  return (
    <span className="inline-flex items-center gap-1.5" title={`${s.label} priority`}>
      <span className={cn("h-2 w-2 rounded-full", s.dot)} />
      {withLabel && <span className="text-xs text-muted-foreground">{s.label}</span>}
    </span>
  );
}

export function StatusDot({ color }: { color?: string | null }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color || "hsl(var(--muted-foreground))" }}
    />
  );
}
