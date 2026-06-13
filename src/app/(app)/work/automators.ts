/**
 * Lightweight automators engine.
 *
 * After a relevant work-item event (currently `status_changed`), look up enabled
 * `automators` whose trigger matches and whose JSON `conditions` are satisfied,
 * then apply simple `actions` (set_status / assign / notify).
 *
 * Kept intentionally minimal but real: it reads/writes the DB, logs activity,
 * creates notifications, pushes realtime events, and bumps run counters.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { emitToUser } from "@/server/realtime";
import type { AutomatorTrigger, WorkItem } from "@/db/schema";

type Ctx = {
  actorId: string | null;
  fromStatusId?: string | null;
  toStatusId?: string | null;
};

function conditionsMatch(
  conditions: Record<string, unknown> | null | undefined,
  item: WorkItem,
  ctx: Ctx,
): boolean {
  if (!conditions) return true;
  const c = conditions;
  // Each present condition key must match. Unknown keys are ignored.
  if (typeof c.fromStatusId === "string" && c.fromStatusId !== ctx.fromStatusId) return false;
  if (typeof c.toStatusId === "string" && c.toStatusId !== ctx.toStatusId) return false;
  if (typeof c.workTypeId === "string" && c.workTypeId !== item.workTypeId) return false;
  if (typeof c.priority === "string" && c.priority !== item.priority) return false;
  if (typeof c.organizationId === "string" && c.organizationId !== item.organizationId) return false;
  return true;
}

/**
 * Run automators for a status change. Returns a short list of human-readable
 * descriptions of what fired (useful for toasts / logging).
 */
export async function runStatusChangedAutomators(
  workItemId: string,
  ctx: Ctx,
): Promise<string[]> {
  const fired: string[] = [];

  const [item] = await db
    .select()
    .from(schema.workItems)
    .where(eq(schema.workItems.id, workItemId))
    .limit(1);
  if (!item) return fired;

  const trigger: AutomatorTrigger = "status_changed";
  const rules = await db
    .select()
    .from(schema.automators)
    .where(and(eq(schema.automators.enabled, true), eq(schema.automators.trigger, trigger)));

  // Snapshot of the item we mutate as actions run so later conditions see updates.
  let current: WorkItem = item;

  for (const rule of rules) {
    if (!conditionsMatch(rule.conditions ?? null, current, ctx)) continue;

    const params = (rule.actionParams ?? {}) as Record<string, unknown>;
    let didSomething = false;

    if (rule.action === "set_status" && typeof params.statusId === "string") {
      const newStatusId = params.statusId;
      if (newStatusId !== current.statusId) {
        // Look up category to decide completedAt.
        const [st] = await db
          .select()
          .from(schema.workStatuses)
          .where(eq(schema.workStatuses.id, newStatusId))
          .limit(1);
        const completedAt =
          st?.category === "done" ? new Date() : current.completedAt;
        await db
          .update(schema.workItems)
          .set({ statusId: newStatusId, completedAt, updatedAt: new Date() })
          .where(eq(schema.workItems.id, current.id));
        current = { ...current, statusId: newStatusId, completedAt: completedAt ?? null };
        didSomething = true;
      }
    } else if (rule.action === "assign" && typeof params.assigneeId === "string") {
      const assigneeId = params.assigneeId;
      if (assigneeId !== current.assigneeId) {
        await db
          .update(schema.workItems)
          .set({ assigneeId, updatedAt: new Date() })
          .where(eq(schema.workItems.id, current.id));
        current = { ...current, assigneeId };
        // Notify the new assignee.
        const [notif] = await db
          .insert(schema.notifications)
          .values({
            userId: assigneeId,
            type: "automator",
            title: `Assigned by automator: ${rule.name}`,
            body: current.title,
            entityKind: "work_item",
            entityId: current.id,
          })
          .returning();
        if (notif) emitToUser(assigneeId, "notification", notif);
        didSomething = true;
      }
    } else if (rule.action === "notify") {
      const message =
        (typeof params.message === "string" && params.message) ||
        `${rule.name}: ${current.title}`;
      // notify target: explicit userId, or the item assignee.
      const targetId =
        (typeof params.userId === "string" && params.userId) ||
        current.assigneeId ||
        null;
      if (targetId) {
        const [notif] = await db
          .insert(schema.notifications)
          .values({
            userId: targetId,
            type: "automator",
            title: rule.name,
            body: message,
            entityKind: "work_item",
            entityId: current.id,
          })
          .returning();
        if (notif) emitToUser(targetId, "notification", notif);
        didSomething = true;
      }
    }

    if (didSomething) {
      await db
        .update(schema.automators)
        .set({ runCount: rule.runCount + 1, lastRunAt: new Date() })
        .where(eq(schema.automators.id, rule.id));
      await db.insert(schema.activities).values({
        actorId: ctx.actorId,
        verb: "automated",
        entityKind: "work_item",
        entityId: current.id,
        summary: `Automator "${rule.name}" ran (${rule.action})`,
        meta: { automatorId: rule.id, action: rule.action },
      });
      fired.push(rule.name);
    }
  }

  return fired;
}
