"use client";
import * as React from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { WorkUser, WorkStatus, WorkTypeLite } from "./types";

export type Filters = {
  search: string;
  assigneeId: string; // "all" | "unassigned" | id
  statusId: string; // "all" | id
  workTypeId: string; // "all" | id
};

export const ALL = "all";

export function FiltersBar({
  filters,
  onChange,
  users,
  statuses,
  workTypes,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  users: WorkUser[];
  statuses: WorkStatus[];
  workTypes: WorkTypeLite[];
}) {
  const dirty =
    filters.search !== "" ||
    filters.assigneeId !== ALL ||
    filters.statusId !== ALL ||
    filters.workTypeId !== ALL;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search work…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="pl-8"
        />
      </div>

      <Select value={filters.assigneeId} onValueChange={(v) => onChange({ ...filters, assigneeId: v })}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Assignee" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All assignees</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {users.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.statusId} onValueChange={(v) => onChange({ ...filters, statusId: v })}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {statuses.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.workTypeId} onValueChange={(v) => onChange({ ...filters, workTypeId: v })}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Work type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All types</SelectItem>
          {workTypes.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {dirty && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ search: "", assigneeId: ALL, statusId: ALL, workTypeId: ALL })}
        >
          <X className="h-4 w-4" /> Clear
        </Button>
      )}
    </div>
  );
}
