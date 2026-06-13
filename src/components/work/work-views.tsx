"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { isToday, isTomorrow } from "date-fns";
import { Plus, LayoutGrid, List, CalendarDays, Briefcase, FileStack } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Board } from "./board";
import { ListView } from "./list-view";
import { CalendarView } from "./calendar-view";
import { FiltersBar, ALL, type Filters } from "./filters-bar";
import { WorkDialog } from "./work-dialog";
import type { BoardData, WorkItemRow, WorkItem } from "./types";

type PrefilterMode = "overdue" | "week" | null;

export function WorkViews({ data }: { data: BoardData }) {
  const { statuses, items, users, orgs, workTypes } = data;
  const searchParams = useSearchParams();

  const prefilter = (searchParams.get("filter") as PrefilterMode) ?? null;

  const [filters, setFilters] = React.useState<Filters>({
    search: "",
    assigneeId: ALL,
    statusId: ALL,
    workTypeId: ALL,
  });

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<WorkItem | null>(null);
  const [defaultStatusId, setDefaultStatusId] = React.useState<string | null>(null);

  // Open the create dialog if ?new=1 is present.
  React.useEffect(() => {
    if (searchParams.get("new") === "1") {
      setEditItem(null);
      setDefaultStatusId(null);
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = new Date();
  const weekAhead = new Date(Date.now() + 7 * 86400_000);

  const filtered = React.useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return items.filter((it) => {
      if (q && !it.title.toLowerCase().includes(q) && !(it.orgName ?? "").toLowerCase().includes(q))
        return false;
      if (filters.assigneeId === "unassigned" && it.assigneeId) return false;
      if (filters.assigneeId !== ALL && filters.assigneeId !== "unassigned" && it.assigneeId !== filters.assigneeId)
        return false;
      if (filters.statusId !== ALL && it.statusId !== filters.statusId) return false;
      if (filters.workTypeId !== ALL && it.workTypeId !== filters.workTypeId) return false;

      if (prefilter === "overdue") {
        if (it.completedAt || !it.dueDate || new Date(it.dueDate) >= now) return false;
      } else if (prefilter === "week") {
        if (it.completedAt || !it.dueDate) return false;
        const d = new Date(it.dueDate);
        if (d > weekAhead) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filters, prefilter]);

  function openCreate(statusId?: string | null) {
    setEditItem(null);
    setDefaultStatusId(statusId ?? null);
    setDialogOpen(true);
  }

  const counts = {
    overdue: items.filter((i) => !i.completedAt && i.dueDate && new Date(i.dueDate) < now).length,
    dueSoon: items.filter(
      (i) => !i.completedAt && i.dueDate && (isToday(new Date(i.dueDate)) || isTomorrow(new Date(i.dueDate))),
    ).length,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Work</h1>
          <p className="text-muted-foreground">
            {items.length} open · {counts.overdue} overdue · {counts.dueSoon} due soon
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/work/templates">
              <FileStack className="h-4 w-4" /> Templates
            </Link>
          </Button>
          <Button onClick={() => openCreate()}>
            <Plus className="h-4 w-4" /> New work
          </Button>
        </div>
      </div>

      {prefilter && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span className="font-medium">
            Showing {prefilter === "overdue" ? "overdue" : "due-this-week"} work only.
          </span>
          <Link href="/work" className="text-primary hover:underline">
            Clear
          </Link>
        </div>
      )}

      <Tabs defaultValue="board" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="board" className="gap-1.5">
              <LayoutGrid className="h-4 w-4" /> Board
            </TabsTrigger>
            <TabsTrigger value="list" className="gap-1.5">
              <List className="h-4 w-4" /> List
            </TabsTrigger>
            <TabsTrigger value="calendar" className="gap-1.5">
              <CalendarDays className="h-4 w-4" /> Calendar
            </TabsTrigger>
          </TabsList>
          <FiltersBar
            filters={filters}
            onChange={setFilters}
            users={users}
            statuses={statuses}
            workTypes={workTypes}
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState onCreate={() => openCreate()} hasItems={items.length > 0} />
        ) : (
          <>
            <TabsContent value="board">
              {statuses.length === 0 ? (
                <NoStatuses />
              ) : (
                <Board statuses={statuses} items={filtered} users={users} onAddInStatus={openCreate} />
              )}
            </TabsContent>
            <TabsContent value="list">
              <ListView items={filtered} statuses={statuses} users={users} />
            </TabsContent>
            <TabsContent value="calendar">
              <CalendarView items={filtered} users={users} />
            </TabsContent>
          </>
        )}
      </Tabs>

      <WorkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editItem}
        users={users}
        orgs={orgs}
        workTypes={workTypes}
        statuses={statuses}
        defaultStatusId={defaultStatusId}
      />
    </div>
  );
}

function EmptyState({ onCreate, hasItems }: { onCreate: () => void; hasItems: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Briefcase className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-semibold">{hasItems ? "No matching work" : "No work yet"}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {hasItems
          ? "Try clearing filters or search to see more."
          : "Create your first job, return, or task to get the board rolling."}
      </p>
      {!hasItems && (
        <Button className="mt-5" onClick={onCreate}>
          <Plus className="h-4 w-4" /> New work
        </Button>
      )}
    </div>
  );
}

function NoStatuses() {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 py-16 text-center text-sm text-muted-foreground">
      No board columns configured. Add work statuses in Settings to use the board.
    </div>
  );
}

// Keep type import used.
export type { WorkItemRow };
