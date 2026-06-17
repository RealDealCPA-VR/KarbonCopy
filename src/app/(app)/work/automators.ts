/**
 * Automators engine (revived & extended).
 *
 * After a relevant event, look up enabled `automators` whose trigger matches and
 * whose JSON `conditions` are satisfied, then apply their `actions`. It reads/
 * writes the DB, logs activity, creates notifications, pushes realtime events,
 * and bumps run counters.
 *
 * Triggers now supported:
 *   status_changed   — a work item moved columns          (work/actions.ts)
 *   work_created     — a new work item was created         (work/actions.ts)
 *   task_completed   — a checklist task was completed      (toggleTask)
 *   all_tasks_done   — the last open task was completed    (toggleTask)
 *   due_approaching  — due date within N days (scheduler)  (scheduler.ts)
 *   file_event       — NOT YET WIRED (no runAutomators("file_event") caller);
 *                      disabled in the UI + rejected by the settings validator.
 *
 * Actions now supported:
 *   set_status  | assign | notify | create_task | create_work | send_email(stub)
 *
 * Public API:
 *   runStatusChangedAutomators(workItemId, ctx)   — kept for moveWorkItem (unchanged signature)
 *   runAutomators(trigger, ctx)                   — generic runner for everything else
 */
import "server-only";
import { and, eq, asc, max } from "drizzle-orm";
import { db, schema } from "@/db";
import { emitToUser } from "@/server/realtime";
import type { AutomatorTrigger, WorkItem, Automator } from "@/db/schema";

/* ------------------------------------------------------------------ */
/* Context                                                            */
/* ------------------------------------------------------------------ */

export type AutomatorContext = {
  actorId?: string | null;
  /** The work item the event concerns (required for work-scoped triggers). */
  workItemId?: string | null;
  /** status_changed transition. */
  fromStatusId?: string | null;
  toStatusId?: string | null;
  /** task_completed / all_tasks_done. */
  taskId?: string | null;
  /** due_approaching: how many days out we detected (for messaging). */
  daysUntilDue?: number | null;
  /** file_event: details for templating / linking. */
  file?: { fileName?: string; filePath?: string; organizationId?: string | null } | null;
};

type Ctx = AutomatorContext;

/* ------------------------------------------------------------------ */
/* Condition matching                                                 */
/* ------------------------------------------------------------------ */

function conditionsMatch(
  conditions: Record<string, unknown> | null | undefined,
  item: WorkItem | null,
  ctx: Ctx,
): boolean {
  if (!conditions) return true;
  const c = conditions;
  // Each present condition key must match. Unknown keys are ignored.
  if (typeof c.fromStatusId === "string" && c.fromStatusId !== ctx.fromStatusId) return false;
  if (typeof c.toStatusId === "string" && c.toStatusId !== ctx.toStatusId) return false;
  if (item) {
    if (typeof c.workTypeId === "string" && c.workTypeId !== item.workTypeId) return false;
    if (typeof c.priority === "string" && c.priority !== item.priority) return false;
    if (typeof c.organizationId === "string" && c.organizationId !== item.organizationId) return false;
  }
  // due_approaching threshold: only fire when within `withinDays`.
  if (typeof c.withinDays === "number" && typeof ctx.daysUntilDue === "number") {
    if (ctx.daysUntilDue > c.withinDays) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Activity / counter bookkeeping                                     */
/* ------------------------------------------------------------------ */

async function recordRun(rule: Automator, ctx: Ctx, entityId: string) {
  await db
    .update(schema.automators)
    .set({ runCount: rule.runCount + 1, lastRunAt: new Date() })
    .where(eq(schema.automators.id, rule.id));
  await db.insert(schema.activities).values({
    actorId: ctx.actorId ?? null,
    verb: "automated",
    entityKind: "work_item",
    entityId,
    summary: `Automator "${rule.name}" ran (${rule.action})`,
    meta: { automatorId: rule.id, action: rule.action, trigger: rule.trigger },
  });
}

async function notifyUser(
  userId: string,
  title: string,
  body: string,
  entityId: string,
) {
  const [notif] = await db
    .insert(schema.notifications)
    .values({
      userId,
      type: "automator",
      title,
      body,
      entityKind: "work_item",
      entityId,
    })
    .returning();
  if (notif) emitToUser(userId, "notification", notif);
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/* ------------------------------------------------------------------ */
/* Action application                                                 */
/* ------------------------------------------------------------------ */

/**
 * Apply a single automator's action against the (mutable) current work item.
 * Returns the (possibly updated) work item and whether anything happened.
 */
async function applyAction(
  rule: Automator,
  current: WorkItem | null,
  ctx: Ctx,
): Promise<{ item: WorkItem | null; didSomething: boolean }> {
  const params = (rule.actionParams ?? {}) as Record<string, unknown>;
  let item = current;
  let didSomething = false;

  const vars: Record<string, string> = {
    title: item?.title ?? "",
    file: ctx.file?.fileName ?? "",
    days: ctx.daysUntilDue != null ? String(ctx.daysUntilDue) : "",
  };

  switch (rule.action) {
    case "set_status": {
      if (item && typeof params.statusId === "string" && params.statusId !== item.statusId) {
        const [st] = await db
          .select()
          .from(schema.workStatuses)
          .where(eq(schema.workStatuses.id, params.statusId))
          .limit(1);
        const completedAt = st?.category === "done" ? new Date() : item.completedAt;
        await db
          .update(schema.workItems)
          .set({ statusId: params.statusId, completedAt, updatedAt: new Date() })
          .where(eq(schema.workItems.id, item.id));
        item = { ...item, statusId: params.statusId, completedAt: completedAt ?? null };
        didSomething = true;
      }
      break;
    }

    case "assign": {
      if (item && typeof params.assigneeId === "string" && params.assigneeId !== item.assigneeId) {
        await db
          .update(schema.workItems)
          .set({ assigneeId: params.assigneeId, updatedAt: new Date() })
          .where(eq(schema.workItems.id, item.id));
        item = { ...item, assigneeId: params.assigneeId };
        await notifyUser(
          params.assigneeId,
          `Assigned by automator: ${rule.name}`,
          item.title,
          item.id,
        );
        didSomething = true;
      }
      break;
    }

    case "notify": {
      const message =
        (typeof params.message === "string" && fillTemplate(params.message, vars)) ||
        `${rule.name}: ${item?.title ?? ctx.file?.fileName ?? ""}`;
      const targetId =
        (typeof params.userId === "string" && params.userId) ||
        item?.assigneeId ||
        null;
      if (targetId) {
        await notifyUser(targetId, rule.name, message, item?.id ?? "compliance");
        didSomething = true;
      }
      break;
    }

    case "create_task": {
      if (item && typeof params.title === "string" && params.title.trim()) {
        const [{ value: maxPos } = { value: null }] = await db
          .select({ value: max(schema.workTasks.position) })
          .from(schema.workTasks)
          .where(eq(schema.workTasks.workItemId, item.id));
        await db.insert(schema.workTasks).values({
          workItemId: item.id,
          title: fillTemplate(params.title, vars),
          section: typeof params.section === "string" ? params.section : null,
          assigneeId: typeof params.assigneeId === "string" ? params.assigneeId : null,
          position: (maxPos ?? 0) + 1,
        });
        didSomething = true;
      }
      break;
    }

    case "create_work": {
      if (typeof params.title === "string" && params.title.trim()) {
        const [firstStatus] = await db
          .select()
          .from(schema.workStatuses)
          .orderBy(asc(schema.workStatuses.position))
          .limit(1);
        const dueDate =
          typeof params.dueInDays === "number"
            ? new Date(Date.now() + params.dueInDays * 86400_000)
            : null;
        const [created] = await db
          .insert(schema.workItems)
          .values({
            title: fillTemplate(params.title, vars),
            description: typeof params.description === "string" ? params.description : null,
            workTypeId: typeof params.workTypeId === "string" ? params.workTypeId : null,
            statusId: (typeof params.statusId === "string" && params.statusId) || firstStatus?.id || null,
            organizationId:
              (typeof params.organizationId === "string" && params.organizationId) ||
              item?.organizationId ||
              ctx.file?.organizationId ||
              null,
            assigneeId: typeof params.assigneeId === "string" ? params.assigneeId : item?.assigneeId ?? null,
            dueDate,
            priority: "normal",
          })
          .returning();
        if (created?.assigneeId) {
          await notifyUser(created.assigneeId, `New work: ${created.title}`, rule.name, created.id);
        }
        didSomething = true;
      }
      break;
    }

    case "send_email": {
      // Email sending is owned by the inbox/email module. We record intent as a
      // notification + activity so nothing is silently dropped.
      const to =
        (typeof params.userId === "string" && params.userId) || item?.assigneeId || null;
      const message =
        (typeof params.message === "string" && fillTemplate(params.message, vars)) || rule.name;
      if (to) {
        await notifyUser(to, `Email queued: ${rule.name}`, message, item?.id ?? "compliance");
        didSomething = true;
      }
      break;
    }
  }

  return { item, didSomething };
}

/* ------------------------------------------------------------------ */
/* Core runner                                                        */
/* ------------------------------------------------------------------ */

async function loadRules(trigger: AutomatorTrigger): Promise<Automator[]> {
  return db
    .select()
    .from(schema.automators)
    .where(and(eq(schema.automators.enabled, true), eq(schema.automators.trigger, trigger)));
}

/**
 * Generic automator runner. Loads the work item (if any), evaluates each enabled
 * rule for `trigger`, applies matching actions, and returns the names that fired.
 * Resilient: a failure in one rule does not abort the others.
 */
export async function runAutomators(
  trigger: AutomatorTrigger,
  ctx: AutomatorContext,
): Promise<string[]> {
  const fired: string[] = [];

  let current: WorkItem | null = null;
  if (ctx.workItemId) {
    const [item] = await db
      .select()
      .from(schema.workItems)
      .where(eq(schema.workItems.id, ctx.workItemId))
      .limit(1);
    current = item ?? null;
    if (!current) return fired; // work-scoped trigger but item gone
  }

  let rules: Automator[];
  try {
    rules = await loadRules(trigger);
  } catch (err) {
    console.error(`[automators] could not load rules for ${trigger}:`, err);
    return fired;
  }

  for (const rule of rules) {
    try {
      if (!conditionsMatch(rule.conditions ?? null, current, ctx)) continue;
      const { item, didSomething } = await applyAction(rule, current, ctx);
      current = item;
      if (didSomething) {
        await recordRun(rule, ctx, current?.id ?? ctx.workItemId ?? "compliance");
        fired.push(rule.name);
      }
    } catch (err) {
      console.error(`[automators] rule "${rule.name}" failed:`, err);
    }
  }

  return fired;
}

/* ------------------------------------------------------------------ */
/* Back-compat wrapper (DO NOT change signature — used by moveWorkItem)*/
/* ------------------------------------------------------------------ */

export async function runStatusChangedAutomators(
  workItemId: string,
  ctx: { actorId: string | null; fromStatusId?: string | null; toStatusId?: string | null },
): Promise<string[]> {
  return runAutomators("status_changed", {
    actorId: ctx.actorId,
    workItemId,
    fromStatusId: ctx.fromStatusId,
    toStatusId: ctx.toStatusId,
  });
}
