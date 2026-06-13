import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser, hasRole } from "@/lib/auth";
import { startOfWeek, endOfWeek } from "date-fns";
import { TimeWorkspace } from "@/components/time/time-workspace";
import type {
  WorkItemOption,
  TimeEntryRow,
  BudgetRow,
  ApprovalGroup,
} from "@/components/time/types";

export const dynamic = "force-dynamic";

const { timeEntries, workItems, organizations, users } = schema;

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const isManager = hasRole(user, "manager");

  // ---- Week window (Mon–Sun) ----
  const anchor = sp?.week ? new Date(sp.week) : new Date();
  const weekStart = startOfWeek(Number.isNaN(anchor.getTime()) ? new Date() : anchor, {
    weekStartsOn: 1,
  });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  const [
    workItemRows,
    weekEntryRows,
    runningRows,
    actualRows,
    budgetWorkItems,
    userRows,
  ] = await Promise.all([
    // Selectable work items (open engagements) with client name.
    db
      .select({
        id: workItems.id,
        title: workItems.title,
        organizationId: workItems.organizationId,
        clientName: organizations.name,
        assigneeId: workItems.assigneeId,
        budgetMinutes: workItems.budgetMinutes,
        budgetAmountCents: workItems.budgetAmountCents,
      })
      .from(workItems)
      .leftJoin(organizations, eq(workItems.organizationId, organizations.id))
      .where(isNull(workItems.deletedAt))
      .orderBy(asc(workItems.title)),

    // Current user's entries for the selected week (excludes running).
    db
      .select({
        id: timeEntries.id,
        workItemId: timeEntries.workItemId,
        organizationId: timeEntries.organizationId,
        description: timeEntries.description,
        minutes: timeEntries.minutes,
        billable: timeEntries.billable,
        rateCents: timeEntries.rateCents,
        date: timeEntries.date,
        approved: timeEntries.approved,
        workTitle: workItems.title,
        clientName: organizations.name,
      })
      .from(timeEntries)
      .leftJoin(workItems, eq(timeEntries.workItemId, workItems.id))
      .leftJoin(organizations, eq(timeEntries.organizationId, organizations.id))
      .where(
        and(
          eq(timeEntries.userId, user.id),
          eq(timeEntries.running, false),
          gte(timeEntries.date, weekStart),
          lte(timeEntries.date, weekEnd),
        ),
      )
      .orderBy(desc(timeEntries.date)),

    // Any currently running timer for this user.
    db
      .select({
        id: timeEntries.id,
        workItemId: timeEntries.workItemId,
        description: timeEntries.description,
        billable: timeEntries.billable,
        rateCents: timeEntries.rateCents,
        minutes: timeEntries.minutes,
        startedAt: timeEntries.startedAt,
        workTitle: workItems.title,
        clientName: organizations.name,
      })
      .from(timeEntries)
      .leftJoin(workItems, eq(timeEntries.workItemId, workItems.id))
      .leftJoin(organizations, eq(timeEntries.organizationId, organizations.id))
      .where(and(eq(timeEntries.userId, user.id), eq(timeEntries.running, true)))
      .orderBy(desc(timeEntries.startedAt))
      .limit(1),

    // Actuals per work item (all users): minutes + billable amount.
    db
      .select({
        workItemId: timeEntries.workItemId,
        totalMinutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`,
        billableMinutes: sql<number>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.minutes} else 0 end), 0)`,
        billableAmountCents: sql<number>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.minutes} * coalesce(${timeEntries.rateCents}, ${DEFAULT_RATE_CENTS}) else 0 end), 0)`,
      })
      .from(timeEntries)
      .where(eq(timeEntries.running, false))
      .groupBy(timeEntries.workItemId),

    // Work items that have a budget set (for the Budgets tab).
    db
      .select({
        id: workItems.id,
        title: workItems.title,
        organizationId: workItems.organizationId,
        clientName: organizations.name,
        assigneeId: workItems.assigneeId,
        budgetMinutes: workItems.budgetMinutes,
        budgetAmountCents: workItems.budgetAmountCents,
        completedAt: workItems.completedAt,
      })
      .from(workItems)
      .leftJoin(organizations, eq(workItems.organizationId, organizations.id))
      .where(isNull(workItems.deletedAt))
      .orderBy(asc(workItems.title)),

    db
      .select({ id: users.id, name: users.name, image: users.image, color: users.color })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.name)),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u]));

  const workItemOptions: WorkItemOption[] = workItemRows.map((w) => ({
    id: w.id,
    title: w.title,
    organizationId: w.organizationId,
    clientName: w.clientName,
  }));

  const entries: TimeEntryRow[] = weekEntryRows.map((e) => ({
    id: e.id,
    workItemId: e.workItemId,
    organizationId: e.organizationId,
    description: e.description,
    minutes: e.minutes,
    billable: e.billable,
    rateCents: e.rateCents,
    date: e.date.getTime(),
    approved: e.approved,
    workTitle: e.workTitle,
    clientName: e.clientName,
  }));

  const running = runningRows[0]
    ? {
        id: runningRows[0].id,
        workItemId: runningRows[0].workItemId,
        description: runningRows[0].description,
        billable: runningRows[0].billable,
        rateCents: runningRows[0].rateCents,
        minutes: runningRows[0].minutes,
        startedAt: runningRows[0].startedAt ? runningRows[0].startedAt.getTime() : null,
        workTitle: runningRows[0].workTitle,
        clientName: runningRows[0].clientName,
      }
    : null;

  const actualMap = new Map(actualRows.map((a) => [a.workItemId, a]));

  const budgets: BudgetRow[] = budgetWorkItems
    .filter((w) => (w.budgetMinutes ?? 0) > 0 || (w.budgetAmountCents ?? 0) > 0)
    .map((w) => {
      const actual = actualMap.get(w.id);
      const assignee = w.assigneeId ? userMap.get(w.assigneeId) : undefined;
      return {
        id: w.id,
        title: w.title,
        organizationId: w.organizationId,
        clientName: w.clientName,
        assigneeId: w.assigneeId,
        assigneeName: assignee?.name ?? null,
        budgetMinutes: w.budgetMinutes,
        budgetAmountCents: w.budgetAmountCents,
        actualMinutes: Number(actual?.totalMinutes ?? 0),
        billableMinutes: Number(actual?.billableMinutes ?? 0),
        billableAmountCents: Number(actual?.billableAmountCents ?? 0),
        completed: w.completedAt != null,
      };
    });

  // ---- Approvals (manager+) ----
  let approvalGroups: ApprovalGroup[] = [];
  if (isManager) {
    const pending = await db
      .select({
        id: timeEntries.id,
        userId: timeEntries.userId,
        description: timeEntries.description,
        minutes: timeEntries.minutes,
        billable: timeEntries.billable,
        rateCents: timeEntries.rateCents,
        date: timeEntries.date,
        workTitle: workItems.title,
        clientName: organizations.name,
      })
      .from(timeEntries)
      .leftJoin(workItems, eq(timeEntries.workItemId, workItems.id))
      .leftJoin(organizations, eq(timeEntries.organizationId, organizations.id))
      .where(and(eq(timeEntries.approved, false), eq(timeEntries.running, false)))
      .orderBy(desc(timeEntries.date));

    const grouped = new Map<string, ApprovalGroup>();
    for (const p of pending) {
      let g = grouped.get(p.userId);
      if (!g) {
        const u = userMap.get(p.userId);
        g = {
          userId: p.userId,
          userName: u?.name ?? "Unknown",
          userImage: u?.image ?? null,
          userColor: u?.color ?? null,
          entries: [],
        };
        grouped.set(p.userId, g);
      }
      g.entries.push({
        id: p.id,
        description: p.description,
        minutes: p.minutes,
        billable: p.billable,
        rateCents: p.rateCents,
        date: p.date.getTime(),
        workTitle: p.workTitle,
        clientName: p.clientName,
      });
    }
    approvalGroups = Array.from(grouped.values()).sort((a, b) =>
      a.userName.localeCompare(b.userName),
    );
  }

  return (
    <TimeWorkspace
      currentUserName={user.name}
      isManager={isManager}
      defaultTab={sp?.tab}
      weekStartMs={weekStart.getTime()}
      workItems={workItemOptions}
      entries={entries}
      running={running}
      budgets={budgets}
      assignees={userRows
        .filter((u) => budgets.some((b) => b.assigneeId === u.id))
        .map((u) => ({ id: u.id, name: u.name }))}
      clients={dedupeClients(budgets)}
      approvalGroups={approvalGroups}
      defaultRateCents={DEFAULT_RATE_CENTS}
    />
  );
}

const DEFAULT_RATE_CENTS = 15000;

function dedupeClients(budgets: BudgetRow[]): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const b of budgets) {
    if (b.organizationId && b.clientName) m.set(b.organizationId, b.clientName);
  }
  return Array.from(m.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
