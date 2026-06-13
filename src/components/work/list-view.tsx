"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn, formatMinutes } from "@/lib/utils";
import { AssigneeAvatar, DueBadge, PriorityDot, StatusDot } from "./work-bits";
import { PRIORITY_ORDER } from "./types";
import type { WorkItemRow, WorkStatus, WorkUser } from "./types";

type SortKey = "title" | "orgName" | "workTypeName" | "assignee" | "status" | "dueDate" | "budgetMinutes" | "priority";

export function ListView({
  items,
  statuses,
  users,
}: {
  items: WorkItemRow[];
  statuses: WorkStatus[];
  users: WorkUser[];
}) {
  const router = useRouter();
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "dueDate",
    dir: "asc",
  });

  const userById = React.useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const statusById = React.useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);

  const sorted = React.useMemo(() => {
    const arr = [...items];
    const dir = sort.dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      switch (sort.key) {
        case "title":
          av = a.title.toLowerCase();
          bv = b.title.toLowerCase();
          break;
        case "orgName":
          av = (a.orgName ?? "").toLowerCase();
          bv = (b.orgName ?? "").toLowerCase();
          break;
        case "workTypeName":
          av = (a.workTypeName ?? "").toLowerCase();
          bv = (b.workTypeName ?? "").toLowerCase();
          break;
        case "assignee":
          av = (a.assigneeId ? userById.get(a.assigneeId)?.name ?? "" : "").toLowerCase();
          bv = (b.assigneeId ? userById.get(b.assigneeId)?.name ?? "" : "").toLowerCase();
          break;
        case "status":
          av = a.statusId ? statusById.get(a.statusId)?.position ?? 0 : -1;
          bv = b.statusId ? statusById.get(b.statusId)?.position ?? 0 : -1;
          break;
        case "dueDate":
          av = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          bv = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          break;
        case "budgetMinutes":
          av = a.budgetMinutes ?? -1;
          bv = b.budgetMinutes ?? -1;
          break;
        case "priority":
          av = PRIORITY_ORDER[a.priority];
          bv = PRIORITY_ORDER[b.priority];
          break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [items, sort, userById, statusById]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  function Th({ label, k, className }: { label: string; k: SortKey; className?: string }) {
    const active = sort.key === k;
    return (
      <TableHead className={className}>
        <button
          onClick={() => toggleSort(k)}
          className={cn(
            "inline-flex items-center gap-1 transition-colors hover:text-foreground",
            active && "text-foreground",
          )}
        >
          {label}
          {active ? (
            sort.dir === "asc" ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            )
          ) : (
            <ChevronsUpDown className="h-3 w-3 opacity-40" />
          )}
        </button>
      </TableHead>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <Th label="Title" k="title" />
            <Th label="Client" k="orgName" />
            <Th label="Type" k="workTypeName" />
            <Th label="Assignee" k="assignee" />
            <Th label="Status" k="status" />
            <Th label="Due" k="dueDate" />
            <Th label="Budget" k="budgetMinutes" className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((item) => {
            const status = item.statusId ? statusById.get(item.statusId) : null;
            const assignee = item.assigneeId ? userById.get(item.assigneeId) : null;
            return (
              <TableRow
                key={item.id}
                className="cursor-pointer"
                onClick={() => router.push(`/work/${item.id}`)}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <PriorityDot priority={item.priority} />
                    <span className="line-clamp-1">{item.title}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{item.orgName ?? "—"}</TableCell>
                <TableCell>
                  {item.workTypeName ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: (item.workTypeColor || "#6366f1") + "22",
                        color: item.workTypeColor || "#6366f1",
                      }}
                    >
                      {item.workTypeName}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <AssigneeAvatar user={assignee} size={22} />
                    <span className="text-sm text-muted-foreground">{assignee?.name ?? "Unassigned"}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {status ? (
                    <Badge variant="outline" className="gap-1.5">
                      <StatusDot color={status.color} />
                      {status.name}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <DueBadge due={item.dueDate} completed={!!item.completedAt} /> {!item.dueDate && <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {item.budgetMinutes ? formatMinutes(item.budgetMinutes) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
