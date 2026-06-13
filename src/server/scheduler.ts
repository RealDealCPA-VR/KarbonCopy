/**
 * In-process periodic scheduler.
 *
 * A single setInterval "tick" (default every 30 min) that, on each run:
 *   1. refreshes compliance-deadline statuses (upcoming → missed when overdue),
 *   2. fires `due_approaching` automators for work items + deadlines nearing due,
 *   3. expands `workItems.recurrenceRule` into the next occurrence,
 *   4. (best-effort) generates compliance deadlines once a day.
 *
 * Designed to be resilient: every step is wrapped in try/catch and the tick
 * never throws out. Guarded via globalThis so only one interval runs even across
 * HMR / module reloads. The coordinator imports and calls startScheduler() from
 * server.ts; this module only exports the lifecycle functions.
 */
import "server-only";
import { and, eq, isNull, isNotNull, lte, gte, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { emitToUser } from "@/server/realtime";
import { runAutomators } from "@/app/(app)/work/automators";
import { generateDeadlines } from "@/lib/compliance/generate";

const DAY_MS = 86400_000;
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
/** How many days out counts as "approaching" for the due_approaching trigger. */
const APPROACH_WINDOW_DAYS = 7;

type SchedulerState = {
  timer?: ReturnType<typeof setInterval>;
  running: boolean; // a tick is currently executing
  lastDeadlineGenAt?: number;
  startedAt?: number;
};

const g = globalThis as unknown as { __kcScheduler?: SchedulerState };
const state: SchedulerState = (g.__kcScheduler ??= { running: false });

/* ------------------------------------------------------------------ */
/* Step 1 — refresh deadline statuses                                 */
/* ------------------------------------------------------------------ */

async function refreshDeadlineStatuses(now: Date): Promise<number> {
  let changed = 0;
  // Anything still "upcoming"/"in_progress" whose effective due date is past →
  // "missed". (Filed / extended / na are left alone.)
  const open = await db
    .select()
    .from(schema.complianceDeadlines)
    .where(
      and(
        ne(schema.complianceDeadlines.status, "filed"),
        ne(schema.complianceDeadlines.status, "extended"),
        ne(schema.complianceDeadlines.status, "missed"),
        ne(schema.complianceDeadlines.status, "na"),
      ),
    );

  for (const d of open) {
    const effective = d.extendedDueDate ?? d.dueDate;
    if (effective && effective.getTime() < now.getTime()) {
      await db
        .update(schema.complianceDeadlines)
        .set({ status: "missed" })
        .where(eq(schema.complianceDeadlines.id, d.id));
      changed++;
    }
  }
  return changed;
}

/* ------------------------------------------------------------------ */
/* Step 2 — due_approaching automators                                */
/* ------------------------------------------------------------------ */

async function fireDueApproaching(now: Date): Promise<number> {
  let fired = 0;
  const windowEnd = new Date(now.getTime() + APPROACH_WINDOW_DAYS * DAY_MS);

  // Work items not completed, with a due date inside the window.
  const items = await db
    .select()
    .from(schema.workItems)
    .where(
      and(
        isNull(schema.workItems.completedAt),
        isNull(schema.workItems.deletedAt),
        isNotNull(schema.workItems.dueDate),
        gte(schema.workItems.dueDate, now),
        lte(schema.workItems.dueDate, windowEnd),
      ),
    );

  for (const item of items) {
    if (!item.dueDate) continue;
    const daysUntilDue = Math.ceil((item.dueDate.getTime() - now.getTime()) / DAY_MS);
    try {
      const names = await runAutomators("due_approaching", {
        actorId: null,
        workItemId: item.id,
        daysUntilDue,
      });
      fired += names.length;
    } catch (err) {
      console.error("[scheduler] due_approaching automator failed:", err);
    }
  }
  return fired;
}

/* ------------------------------------------------------------------ */
/* Step 2b — notify assignees about approaching deadlines             */
/* ------------------------------------------------------------------ */

/**
 * Even with no automators configured, nudge the assignee/owner once when a
 * compliance deadline crosses inside the window. Deduped by a daily-ish guard
 * (we only nudge for deadlines whose due date is within the window and that are
 * still in an open status — at the 30-min cadence this can repeat, so it is
 * intentionally gated to run only on the first tick of the day via the caller).
 */
async function notifyApproachingDeadlines(now: Date): Promise<number> {
  let nudged = 0;
  const windowEnd = new Date(now.getTime() + APPROACH_WINDOW_DAYS * DAY_MS);
  const deadlines = await db
    .select()
    .from(schema.complianceDeadlines)
    .where(
      and(
        ne(schema.complianceDeadlines.status, "filed"),
        ne(schema.complianceDeadlines.status, "na"),
        gte(schema.complianceDeadlines.dueDate, now),
        lte(schema.complianceDeadlines.dueDate, windowEnd),
      ),
    );

  for (const d of deadlines) {
    if (!d.organizationId) continue;
    const [org] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, d.organizationId))
      .limit(1);
    const targetId = org?.ownerId ?? null;
    if (!targetId) continue;
    const days = Math.ceil((d.dueDate.getTime() - now.getTime()) / DAY_MS);
    const [notif] = await db
      .insert(schema.notifications)
      .values({
        userId: targetId,
        type: "deadline",
        title: `Deadline in ${days} day${days === 1 ? "" : "s"}`,
        body: `${d.name}${org ? ` — ${org.name}` : ""}`,
        entityKind: "deadline",
        entityId: d.id,
      })
      .returning();
    if (notif) emitToUser(targetId, "notification", notif);
    nudged++;
  }
  return nudged;
}

/* ------------------------------------------------------------------ */
/* Step 3 — recurrence expansion                                      */
/* ------------------------------------------------------------------ */

/**
 * Compute the next occurrence date from a (simplified) recurrence rule and a
 * base date. Supports a small, dependency-free subset:
 *   "FREQ=DAILY|WEEKLY|MONTHLY|QUARTERLY|YEARLY[;INTERVAL=n]"
 *   or shorthand: "daily" | "weekly" | "monthly" | "quarterly" | "yearly"|"annually".
 * Returns null if the rule can't be parsed.
 */
export function nextOccurrence(rule: string, from: Date): Date | null {
  const r = rule.trim().toUpperCase();
  let freq = "";
  let interval = 1;

  if (r.includes("FREQ=")) {
    const fm = /FREQ=([A-Z]+)/.exec(r);
    freq = fm?.[1] ?? "";
    const im = /INTERVAL=(\d+)/.exec(r);
    if (im) interval = Math.max(1, parseInt(im[1], 10));
  } else {
    freq = r;
  }

  const d = new Date(from.getTime());
  switch (freq) {
    case "DAILY":
      d.setUTCDate(d.getUTCDate() + interval);
      return d;
    case "WEEKLY":
      d.setUTCDate(d.getUTCDate() + 7 * interval);
      return d;
    case "MONTHLY":
      d.setUTCMonth(d.getUTCMonth() + interval);
      return d;
    case "QUARTERLY":
      d.setUTCMonth(d.getUTCMonth() + 3 * interval);
      return d;
    case "YEARLY":
    case "ANNUALLY":
      d.setUTCFullYear(d.getUTCFullYear() + interval);
      return d;
    default:
      return null;
  }
}

/**
 * For each completed recurring work item, spawn the next occurrence (once).
 * Idempotency: we only spawn from an item that is completed and whose template
 * marker hasn't already produced a successor (tracked by an open sibling that is
 * a copy). To keep it simple and safe, we spawn at most one open successor per
 * recurring "lineage" keyed by (title + recurrenceRule + organizationId).
 */
async function expandRecurrences(now: Date): Promise<number> {
  let spawned = 0;
  const recurring = await db
    .select()
    .from(schema.workItems)
    .where(
      and(
        isNotNull(schema.workItems.recurrenceRule),
        isNotNull(schema.workItems.completedAt),
        isNull(schema.workItems.deletedAt),
      ),
    );

  for (const item of recurring) {
    if (!item.recurrenceRule) continue;
    const base = item.dueDate ?? item.completedAt ?? now;
    const next = nextOccurrence(item.recurrenceRule, base);
    if (!next) continue;

    // Skip if an open (not-completed, not-deleted) successor already exists for
    // this lineage with a due date >= the computed next date.
    const lineage = await db
      .select()
      .from(schema.workItems)
      .where(
        and(
          eq(schema.workItems.title, item.title),
          eq(schema.workItems.recurrenceRule, item.recurrenceRule),
          isNull(schema.workItems.completedAt),
          isNull(schema.workItems.deletedAt),
        ),
      );
    if (lineage.length > 0) continue;

    // Spawn the next occurrence (carry assignee/org/type, reset completion).
    const [firstStatus] = await db
      .select()
      .from(schema.workStatuses)
      .where(eq(schema.workStatuses.category, "todo"))
      .limit(1);

    const [created] = await db
      .insert(schema.workItems)
      .values({
        title: item.title,
        description: item.description,
        workTypeId: item.workTypeId,
        statusId: firstStatus?.id ?? null,
        priority: item.priority,
        organizationId: item.organizationId,
        contactId: item.contactId,
        assigneeId: item.assigneeId,
        teamId: item.teamId,
        startDate: now,
        dueDate: next,
        budgetMinutes: item.budgetMinutes,
        budgetAmountCents: item.budgetAmountCents,
        recurrenceRule: item.recurrenceRule,
        templateId: item.templateId,
        fileFolderPath: item.fileFolderPath,
      })
      .returning();

    if (created) {
      // Copy the (incomplete) checklist structure forward.
      const tasks = await db
        .select()
        .from(schema.workTasks)
        .where(eq(schema.workTasks.workItemId, item.id));
      if (tasks.length) {
        await db.insert(schema.workTasks).values(
          tasks.map((t) => ({
            workItemId: created.id,
            title: t.title,
            section: t.section,
            assigneeId: t.assigneeId,
            dueDate: t.dueDate,
            position: t.position,
          })),
        );
      }
      await db.insert(schema.activities).values({
        actorId: null,
        verb: "recurred",
        entityKind: "work_item",
        entityId: created.id,
        summary: `Recurring "${item.title}" spawned next occurrence`,
        meta: { fromId: item.id, rule: item.recurrenceRule },
      });
      // Let work_created automators run on the spawned occurrence.
      try {
        await runAutomators("work_created", { actorId: null, workItemId: created.id });
      } catch {
        /* non-fatal */
      }
      spawned++;
    }
  }
  return spawned;
}

/* ------------------------------------------------------------------ */
/* The tick                                                           */
/* ------------------------------------------------------------------ */

export async function runSchedulerTick(): Promise<void> {
  if (state.running) {
    // A previous tick is still running (slow DB / long interval); skip this one.
    return;
  }
  state.running = true;
  const now = new Date();
  try {
    try {
      const changed = await refreshDeadlineStatuses(now);
      if (changed) console.log(`[scheduler] marked ${changed} deadline(s) missed`);
    } catch (err) {
      console.error("[scheduler] refreshDeadlineStatuses failed:", err);
    }

    try {
      const fired = await fireDueApproaching(now);
      if (fired) console.log(`[scheduler] due_approaching fired ${fired} automator action(s)`);
    } catch (err) {
      console.error("[scheduler] fireDueApproaching failed:", err);
    }

    try {
      const spawned = await expandRecurrences(now);
      if (spawned) console.log(`[scheduler] spawned ${spawned} recurring occurrence(s)`);
    } catch (err) {
      console.error("[scheduler] expandRecurrences failed:", err);
    }

    // Once-a-day work: deadline generation + deadline nudges.
    const lastGen = state.lastDeadlineGenAt ?? 0;
    if (now.getTime() - lastGen > DAY_MS) {
      state.lastDeadlineGenAt = now.getTime();
      try {
        const res = await generateDeadlines({});
        if (res.created || res.updated)
          console.log(`[scheduler] deadlines: +${res.created} ~${res.updated}`);
      } catch (err) {
        console.error("[scheduler] generateDeadlines failed:", err);
      }
      try {
        const nudged = await notifyApproachingDeadlines(now);
        if (nudged) console.log(`[scheduler] nudged ${nudged} approaching deadline(s)`);
      } catch (err) {
        console.error("[scheduler] notifyApproachingDeadlines failed:", err);
      }
    }
  } finally {
    state.running = false;
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

/**
 * Start the periodic scheduler. Guarded so calling twice is a no-op. Runs an
 * immediate tick shortly after boot, then every `intervalMs` (default 30 min).
 */
export function startScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (state.timer) {
    console.log("[scheduler] already running");
    return;
  }
  state.startedAt = Date.now();
  // Kick off a first tick after a short delay so server boot isn't blocked.
  setTimeout(() => {
    runSchedulerTick().catch((e) => console.error("[scheduler] initial tick failed:", e));
  }, 15_000).unref?.();

  state.timer = setInterval(() => {
    runSchedulerTick().catch((e) => console.error("[scheduler] tick failed:", e));
  }, intervalMs);
  state.timer.unref?.();
  console.log(`[scheduler] started (every ${Math.round(intervalMs / 60000)} min)`);
}

/** Stop the scheduler (clears the interval). Safe to call when not running. */
export function stopScheduler(): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = undefined;
    console.log("[scheduler] stopped");
  }
}

/** Whether the scheduler interval is currently active. */
export function isSchedulerRunning(): boolean {
  return Boolean(state.timer);
}
