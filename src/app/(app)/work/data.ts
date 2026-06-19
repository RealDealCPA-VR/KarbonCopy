import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BoardData, WorkItemRow, WorkUser, WorkOrg, WorkContact, WorkTypeLite } from "@/components/work/types";

/** Non-deleted contacts for the work dialog's bill-to / linked-contact selector. */
export async function loadWorkContacts(): Promise<WorkContact[]> {
  const rows = await db
    .select({
      id: schema.contacts.id,
      firstName: schema.contacts.firstName,
      lastName: schema.contacts.lastName,
      organizationId: schema.contacts.organizationId,
    })
    .from(schema.contacts)
    .where(isNull(schema.contacts.deletedAt))
    .orderBy(asc(schema.contacts.lastName), asc(schema.contacts.firstName));
  return rows.map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim(),
    organizationId: c.organizationId,
  }));
}

/** Load everything the board/list/calendar views need in one pass. */
export async function loadBoardData(): Promise<BoardData> {
  // Statuses load first so we know which ones are in the "done" category. Items
  // in a done column must stay on the board (their completedAt is set), so we
  // include any item that is either not completed OR sits in a done status.
  const statuses = await db
    .select()
    .from(schema.workStatuses)
    .orderBy(asc(schema.workStatuses.position));

  const doneStatusIds = statuses.filter((s) => s.category === "done").map((s) => s.id);

  const [rawItems, users, orgs, workTypes] = await Promise.all([
    db
      .select()
      .from(schema.workItems)
      .where(
        and(
          isNull(schema.workItems.deletedAt),
          doneStatusIds.length
            ? or(
                isNull(schema.workItems.completedAt),
                inArray(schema.workItems.statusId, doneStatusIds),
              )
            : isNull(schema.workItems.completedAt),
        ),
      ),
    db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        image: schema.users.image,
        color: schema.users.color,
      })
      .from(schema.users)
      .where(eq(schema.users.active, true))
      .orderBy(asc(schema.users.name)),
    db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(isNull(schema.organizations.deletedAt))
      .orderBy(asc(schema.organizations.name)),
    db
      .select({
        id: schema.workTypes.id,
        name: schema.workTypes.name,
        color: schema.workTypes.color,
        defaultBudgetMinutes: schema.workTypes.defaultBudgetMinutes,
      })
      .from(schema.workTypes)
      .orderBy(asc(schema.workTypes.name)),
  ]);

  const items = await enrichItems(rawItems, orgs, workTypes);

  return {
    statuses,
    items,
    users: users as WorkUser[],
    orgs: orgs as WorkOrg[],
    workTypes: workTypes as WorkTypeLite[],
  };
}

async function enrichItems(
  rawItems: (typeof schema.workItems.$inferSelect)[],
  orgs: { id: string; name: string }[],
  workTypes: WorkTypeLite[],
): Promise<WorkItemRow[]> {
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const wt = new Map(workTypes.map((w) => [w.id, w]));

  // Task counts per work item in one grouped query.
  const ids = rawItems.map((i) => i.id);
  const taskCounts = new Map<string, { total: number; done: number }>();
  if (ids.length) {
    const rows = await db
      .select({
        workItemId: schema.workTasks.workItemId,
        total: sql<number>`count(*)`,
        done: sql<number>`sum(case when ${schema.workTasks.completed} then 1 else 0 end)`,
      })
      .from(schema.workTasks)
      .where(inArray(schema.workTasks.workItemId, ids))
      .groupBy(schema.workTasks.workItemId);
    for (const r of rows) {
      taskCounts.set(r.workItemId, { total: Number(r.total), done: Number(r.done ?? 0) });
    }
  }

  return rawItems.map((it) => {
    const counts = taskCounts.get(it.id) ?? { total: 0, done: 0 };
    const type = it.workTypeId ? wt.get(it.workTypeId) : null;
    return {
      ...it,
      orgName: it.organizationId ? orgName.get(it.organizationId) ?? null : null,
      workTypeName: type?.name ?? null,
      workTypeColor: type?.color ?? null,
      taskTotal: counts.total,
      taskDone: counts.done,
    };
  });
}
