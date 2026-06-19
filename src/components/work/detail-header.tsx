"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Pencil, MoreVertical, Trash2, CheckCircle2, Building2, CalendarClock, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { formatMinutes } from "@/lib/utils";
import { setWorkStatus, deleteWorkItem, markWorkComplete } from "@/app/(app)/work/actions";
import { WorkDialog } from "./work-dialog";
import { AssigneeAvatar, DueBadge, PriorityDot, StatusDot } from "./work-bits";
import { PRIORITY_LABELS } from "./types";
import type { WorkItem, WorkStatus, WorkUser, WorkOrg, WorkContact, WorkTypeLite } from "./types";

export function DetailHeader({
  item,
  statuses,
  users,
  orgs,
  contacts,
  workTypes,
  orgName,
  workTypeName,
}: {
  item: WorkItem;
  statuses: WorkStatus[];
  users: WorkUser[];
  orgs: WorkOrg[];
  contacts: WorkContact[];
  workTypes: WorkTypeLite[];
  orgName: string | null;
  workTypeName: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editOpen, setEditOpen] = React.useState(false);

  const assignee = item.assigneeId ? users.find((u) => u.id === item.assigneeId) : null;
  const status = statuses.find((s) => s.id === item.statusId) ?? null;
  const isComplete = !!item.completedAt;

  function changeStatus(statusId: string) {
    startTransition(async () => {
      try {
        await setWorkStatus(item.id, statusId);
        router.refresh();
      } catch {
        toast.error("Couldn't change status");
      }
    });
  }

  function complete() {
    startTransition(async () => {
      try {
        await markWorkComplete(item.id);
        toast.success("Marked complete");
        router.refresh();
      } catch {
        toast.error("Couldn't complete");
      }
    });
  }

  function remove() {
    startTransition(async () => {
      try {
        await deleteWorkItem(item.id);
        toast.success("Work deleted");
        router.push("/work");
      } catch {
        toast.error("Couldn't delete");
      }
    });
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <PriorityDot priority={item.priority} withLabel />
            {workTypeName && (
              <Badge variant="secondary" className="text-[10px]">
                {workTypeName}
              </Badge>
            )}
            {isComplete && (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Complete
              </Badge>
            )}
          </div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight">{item.title}</h1>
          {item.description && (
            <p className="max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">{item.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="w-48">
            <Select value={item.statusId ?? undefined} onValueChange={changeStatus} disabled={pending}>
              <SelectTrigger>
                <SelectValue placeholder="No status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      <StatusDot color={s.color} />
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="icon" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!isComplete && (
                <DropdownMenuItem onClick={complete}>
                  <CheckCircle2 className="h-4 w-4" /> Mark complete
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={remove} className="text-destructive focus:text-destructive">
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
        <Meta label="Client" icon={Building2}>
          {orgName ? <span className="text-sm font-medium">{orgName}</span> : <Dash />}
        </Meta>
        <Meta label="Assignee" icon={null}>
          <div className="flex items-center gap-2">
            <AssigneeAvatar user={assignee} size={22} />
            <span className="text-sm font-medium">{assignee?.name ?? "Unassigned"}</span>
          </div>
        </Meta>
        <Meta label="Status" icon={null}>
          {status ? (
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <StatusDot color={status.color} /> {status.name}
            </span>
          ) : (
            <Dash />
          )}
        </Meta>
        <Meta label="Priority" icon={null}>
          <span className="text-sm font-medium">{PRIORITY_LABELS[item.priority]}</span>
        </Meta>
        <Meta label="Start" icon={CalendarClock}>
          {item.startDate ? (
            <span className="text-sm font-medium">{format(new Date(item.startDate), "MMM d, yyyy")}</span>
          ) : (
            <Dash />
          )}
        </Meta>
        <Meta label="Due" icon={CalendarClock}>
          {item.dueDate ? <DueBadge due={item.dueDate} completed={isComplete} /> : <Dash />}
        </Meta>
        <Meta label="Budget" icon={Timer}>
          {item.budgetMinutes ? (
            <span className="text-sm font-medium tabular-nums">{formatMinutes(item.budgetMinutes)}</span>
          ) : (
            <Dash />
          )}
        </Meta>
        {isComplete && item.completedAt && (
          <Meta label="Completed" icon={CheckCircle2}>
            <span className="text-sm font-medium">{format(new Date(item.completedAt), "MMM d, yyyy")}</span>
          </Meta>
        )}
      </div>

      <WorkDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        item={item}
        users={users}
        orgs={orgs}
        contacts={contacts}
        workTypes={workTypes}
        statuses={statuses}
      />
    </div>
  );
}

function Meta({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }> | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      {children}
    </div>
  );
}

function Dash() {
  return <span className="text-sm text-muted-foreground">—</span>;
}
