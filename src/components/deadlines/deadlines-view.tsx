"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  format,
  isToday,
  differenceInCalendarDays,
} from "date-fns";
import {
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  Plus,
  ExternalLink,
  ChevronDown,
  List as ListIcon,
  CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { DeadlinesData, DeadlineRow } from "@/app/(app)/deadlines/data";
import type { DeadlineStatus } from "@/db/schema";
import {
  runGenerateDeadlines,
  setDeadlineStatus,
  createWorkForDeadline,
} from "@/app/(app)/deadlines/actions";
import { DeadlineCalendar } from "./deadline-calendar";

const STATUS_META: Record<
  DeadlineStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline" }
> = {
  upcoming: { label: "Upcoming", variant: "secondary" },
  in_progress: { label: "In Progress", variant: "default" },
  filed: { label: "Filed", variant: "success" },
  extended: { label: "Extended", variant: "warning" },
  missed: { label: "Missed", variant: "destructive" },
  na: { label: "N/A", variant: "outline" },
};

const STATUS_OPTIONS: DeadlineStatus[] = [
  "upcoming",
  "in_progress",
  "filed",
  "extended",
  "missed",
  "na",
];

function jurisdictionLabel(j: string): string {
  return j === "federal" ? "Federal" : j.toUpperCase();
}

function effectiveDue(d: DeadlineRow): number {
  return d.extendedDueDate ?? d.dueDate;
}

function isOpen(status: DeadlineStatus): boolean {
  return status === "upcoming" || status === "in_progress" || status === "extended";
}

export function DeadlinesView({ data }: { data: DeadlinesData }) {
  const router = useRouter();
  const [jur, setJur] = React.useState<string>("all");
  const [status, setStatus] = React.useState<string>("all");
  const [client, setClient] = React.useState<string>("all");
  const [isPending, startTransition] = React.useTransition();
  const now = Date.now();

  const filtered = React.useMemo(() => {
    return data.deadlines.filter((d) => {
      if (jur !== "all" && d.jurisdiction !== jur) return false;
      if (status !== "all" && d.status !== status) return false;
      if (client !== "all" && d.organizationId !== client) return false;
      return true;
    });
  }, [data.deadlines, jur, status, client]);

  const stats = React.useMemo(() => {
    let upcoming = 0;
    let overdue = 0;
    let filed = 0;
    let dueSoon = 0; // within 14 days
    for (const d of data.deadlines) {
      const due = effectiveDue(d);
      if (d.status === "filed") filed++;
      else if (d.status === "missed" || (isOpen(d.status) && due < now)) overdue++;
      else if (isOpen(d.status)) {
        upcoming++;
        if (due - now <= 14 * 86400_000 && due >= now) dueSoon++;
      }
    }
    return { upcoming, overdue, filed, dueSoon };
  }, [data.deadlines, now]);

  function handleGenerate(createWorkItems: boolean) {
    startTransition(async () => {
      try {
        const res = await runGenerateDeadlines({
          jurisdictions: jur === "all" ? undefined : [jur],
          createWorkItems,
        });
        toast.success(
          `Generated ${res.created} new, refreshed ${res.updated}` +
            (createWorkItems ? `, ${res.workItemsCreated} work items` : ""),
        );
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message || "Generation failed");
      }
    });
  }

  function handleStatus(id: string, s: DeadlineStatus) {
    startTransition(async () => {
      try {
        await setDeadlineStatus(id, s);
        toast.success(`Marked ${STATUS_META[s].label}`);
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message || "Update failed");
      }
    });
  }

  function handleCreateWork(id: string) {
    startTransition(async () => {
      try {
        const wid = await createWorkForDeadline(id);
        toast.success("Work item created");
        if (wid) router.push(`/work/${wid}`);
      } catch (err) {
        toast.error((err as Error).message || "Failed");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compliance Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Tax & filing deadlines across all clients — from the bundled offline ruleset.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={isPending} className="gap-1.5">
                <Sparkles className="h-4 w-4" />
                Generate deadlines
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => handleGenerate(false)}>
                Generate deadlines only
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleGenerate(true)}>
                Generate + create work items
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Upcoming"
          value={stats.upcoming}
          tone="primary"
        />
        <StatCard
          icon={<CalendarClock className="h-5 w-5" />}
          label="Due within 14 days"
          value={stats.dueSoon}
          tone="warning"
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Overdue"
          value={stats.overdue}
          tone="destructive"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Filed"
          value={stats.filed}
          tone="success"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={jur} onValueChange={setJur}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Jurisdiction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jurisdictions</SelectItem>
            {data.jurisdictions.map((j) => (
              <SelectItem key={j} value={j}>
                {jurisdictionLabel(j)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={client} onValueChange={setClient}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {data.clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto text-sm text-muted-foreground">
          {filtered.length} deadline{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* List + calendar */}
      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list" className="gap-1.5">
            <ListIcon className="h-4 w-4" /> List
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1.5">
            <CalendarDays className="h-4 w-4" /> Calendar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <DeadlineList
            deadlines={filtered}
            now={now}
            isPending={isPending}
            onStatus={handleStatus}
            onCreateWork={handleCreateWork}
          />
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <DeadlineCalendar deadlines={filtered} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "primary" | "warning" | "destructive" | "success";
}) {
  const toneClass = {
    primary: "text-primary bg-primary/10",
    warning: "text-warning bg-warning/10",
    destructive: "text-destructive bg-destructive/10",
    success: "text-success bg-success/10",
  }[tone];
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", toneClass)}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-semibold leading-none">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function DeadlineList({
  deadlines,
  now,
  isPending,
  onStatus,
  onCreateWork,
}: {
  deadlines: DeadlineRow[];
  now: number;
  isPending: boolean;
  onStatus: (id: string, s: DeadlineStatus) => void;
  onCreateWork: (id: string) => void;
}) {
  // Sort: open & soonest first, then filed/na at the bottom.
  const sorted = React.useMemo(() => {
    return [...deadlines].sort((a, b) => {
      const aOpen = isOpen(a.status) ? 0 : 1;
      const bOpen = isOpen(b.status) ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return effectiveDue(a) - effectiveDue(b);
    });
  }, [deadlines]);

  if (!sorted.length) {
    return (
      <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <CalendarClock className="h-10 w-10 text-muted-foreground/50" />
        <div className="text-sm font-medium">No deadlines yet</div>
        <div className="max-w-sm text-sm text-muted-foreground">
          Click <span className="font-medium">Generate deadlines</span> to build the calendar from
          each client&apos;s entity type and fiscal year-end.
        </div>
      </Card>
    );
  }

  return (
    <Card className="divide-y overflow-hidden p-0">
      {sorted.map((d) => {
        const due = effectiveDue(d);
        const days = differenceInCalendarDays(new Date(due), new Date(now));
        const overdue = isOpen(d.status) && due < now;
        const meta = STATUS_META[d.status];
        const usingExtended = d.extendedDueDate != null && d.extendedDueDate === due;
        return (
          <div
            key={d.id}
            className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{d.name}</span>
                {d.form && (
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                    {d.form}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span>{jurisdictionLabel(d.jurisdiction)}</span>
                {d.orgName && (
                  <>
                    <span className="opacity-40">•</span>
                    <span className="truncate">{d.orgName}</span>
                  </>
                )}
                {d.taxPeriod && (
                  <>
                    <span className="opacity-40">•</span>
                    <span>{d.taxPeriod}</span>
                  </>
                )}
              </div>
            </div>

            <div className="text-right">
              <div
                className={cn(
                  "text-sm font-medium tabular-nums",
                  overdue && "text-destructive",
                )}
              >
                {format(new Date(due), "MMM d, yyyy")}
                {usingExtended && (
                  <span className="ml-1 text-[10px] font-normal text-warning">(ext)</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {overdue
                  ? `${Math.abs(days)}d overdue`
                  : isToday(new Date(due))
                    ? "Today"
                    : `in ${days}d`}
              </div>
            </div>

            <Badge variant={meta.variant} className="shrink-0">
              {meta.label}
            </Badge>

            <div className="flex shrink-0 items-center gap-1">
              {d.workItemId ? (
                <Button asChild variant="ghost" size="sm" className="gap-1">
                  <Link href={`/work/${d.workItemId}`}>
                    Work <ExternalLink className="h-3 w-3" />
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  disabled={isPending}
                  onClick={() => onCreateWork(d.id)}
                >
                  <Plus className="h-3 w-3" /> Work
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isPending}>
                    Set status
                    <ChevronDown className="ml-1 h-3 w-3 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {STATUS_OPTIONS.map((s) => (
                    <DropdownMenuItem
                      key={s}
                      disabled={s === d.status}
                      onClick={() => onStatus(d.id, s)}
                    >
                      {STATUS_META[s].label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
