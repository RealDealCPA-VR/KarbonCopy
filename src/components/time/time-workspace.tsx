"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Clock, CalendarDays, Target, ClipboardCheck, Timer } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { TimerBar } from "./timer-bar";
import { TimesheetTab } from "./timesheet-tab";
import { BudgetsTab } from "./budgets-tab";
import { ApprovalsTab } from "./approvals-tab";
import { TimerTab } from "./timer-tab";
import type {
  ApprovalGroup,
  BudgetRow,
  RunningTimer,
  TimeEntryRow,
  WorkItemOption,
} from "./types";

const VALID_TABS = ["timesheet", "timer", "budgets", "approvals"] as const;
type TabKey = (typeof VALID_TABS)[number];

export function TimeWorkspace({
  currentUserName,
  isManager,
  defaultTab,
  weekStartMs,
  workItems,
  entries,
  running,
  budgets,
  clients,
  assignees,
  approvalGroups,
  defaultRateCents,
}: {
  currentUserName: string;
  isManager: boolean;
  defaultTab?: string;
  weekStartMs: number;
  workItems: WorkItemOption[];
  entries: TimeEntryRow[];
  running: RunningTimer | null;
  budgets: BudgetRow[];
  clients: { id: string; name: string }[];
  assignees: { id: string; name: string }[];
  approvalGroups: ApprovalGroup[];
  defaultRateCents: number;
}) {
  const router = useRouter();
  const initial: TabKey =
    defaultTab && (VALID_TABS as readonly string[]).includes(defaultTab)
      ? (defaultTab as TabKey)
      : "timesheet";
  const [tab, setTab] = React.useState<TabKey>(initial);

  const pendingCount = approvalGroups.reduce((s, g) => s + g.entries.length, 0);

  function onTabChange(v: string) {
    setTab(v as TabKey);
    // Keep ?tab in the URL without a full navigation (preserves ?week).
    const url = new URL(window.location.href);
    url.searchParams.set("tab", v);
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Clock className="h-6 w-6 text-primary" /> Time &amp; Budgets
          </h1>
          <p className="text-muted-foreground">
            Track time, manage budgets, and review realization.
          </p>
        </div>
      </div>

      <TimerBar running={running} workItems={workItems} />

      <Tabs value={tab} onValueChange={onTabChange} className="space-y-6">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="timesheet" className="gap-1.5">
            <CalendarDays className="h-4 w-4" /> My Timesheet
          </TabsTrigger>
          <TabsTrigger value="timer" className="gap-1.5">
            <Timer className="h-4 w-4" /> Timer
          </TabsTrigger>
          <TabsTrigger value="budgets" className="gap-1.5">
            <Target className="h-4 w-4" /> Budgets
          </TabsTrigger>
          {isManager && (
            <TabsTrigger value="approvals" className="gap-1.5">
              <ClipboardCheck className="h-4 w-4" /> Approvals
              {pendingCount > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5">
                  {pendingCount}
                </Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="timesheet">
          <TimesheetTab
            weekStartMs={weekStartMs}
            entries={entries}
            workItems={workItems}
            defaultRateCents={defaultRateCents}
          />
        </TabsContent>

        <TabsContent value="timer">
          <TimerTab
            running={running}
            workItems={workItems}
            todayEntries={entries}
            currentUserName={currentUserName}
          />
        </TabsContent>

        <TabsContent value="budgets">
          <BudgetsTab budgets={budgets} clients={clients} assignees={assignees} />
        </TabsContent>

        {isManager && (
          <TabsContent value="approvals">
            <ApprovalsTab groups={approvalGroups} defaultRateCents={defaultRateCents} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
