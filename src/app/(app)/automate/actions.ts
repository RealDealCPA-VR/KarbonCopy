"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { broadcast } from "@/server/realtime";
import {
  AUTOMATOR_TRIGGERS,
  AUTOMATOR_ACTIONS,
  FILE_RULE_EVENTS,
  FILE_RULE_SEVERITIES,
  type WorkflowPlan,
} from "@/lib/ai-workflow";

export type ApplyResult =
  | {
      ok: true;
      data: {
        templateId: string;
        taskCount: number;
        automatorCount: number;
        fileRuleCount: number;
      };
    }
  | { ok: false; error: string };

type FileRuleSeverity = (typeof FILE_RULE_SEVERITIES)[number];

/**
 * Apply an AI-proposed workflow plan: insert the work template + its tasks,
 * any automators, and any file rules, then log an activity.
 *
 * better-sqlite3's db.transaction() callback is SYNCHRONOUS — inside it we use
 * the sync drizzle API (.run(), .returning().all()), never `await`. The
 * pre-transaction reads (for the watched-root needed by file rules) are async
 * and happen first.
 */
export async function applyWorkflowPlan(plan: WorkflowPlan): Promise<ApplyResult> {
  const user = await requireAdmin();

  if (!plan?.workTemplate?.name?.trim()) {
    return { ok: false, error: "Plan is missing a template name." };
  }

  // File rules require a watched root (rootId is NOT NULL). Pick the first one.
  const fileRules = Array.isArray(plan.fileRules) ? plan.fileRules : [];
  let rootId: string | null = null;
  if (fileRules.length) {
    const [root] = await db
      .select({ id: schema.watchedRoots.id })
      .from(schema.watchedRoots)
      .orderBy(asc(schema.watchedRoots.createdAt))
      .limit(1);
    rootId = root?.id ?? null;
  }
  const skipFileRules = fileRules.length > 0 && !rootId;

  const triggers = new Set<string>(AUTOMATOR_TRIGGERS);
  const actions = new Set<string>(AUTOMATOR_ACTIONS);
  const events = new Set<string>(FILE_RULE_EVENTS);
  const severities = new Set<string>(FILE_RULE_SEVERITIES);

  try {
    const result = db.transaction((tx) => {
      const tpl = plan.workTemplate;
      const [template] = tx
        .insert(schema.workTemplates)
        .values({
          name: tpl.name.trim(),
          description: plan.summary?.trim() || null,
          workTypeId: tpl.workTypeId ?? null,
          defaultBudgetMinutes: tpl.defaultBudgetMinutes ?? null,
          recurrenceRule: tpl.recurrenceRule ?? null,
        })
        .returning({ id: schema.workTemplates.id })
        .all();

      const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
      if (tasks.length) {
        tx.insert(schema.templateTasks)
          .values(
            tasks.map((t, i) => ({
              templateId: template.id,
              title: t.title.trim(),
              section: t.section?.trim() || null,
              position: i,
              dueOffsetDays: t.dueOffsetDays ?? null,
            })),
          )
          .run();
      }

      const automators = (Array.isArray(plan.automators) ? plan.automators : []).filter(
        (a) => triggers.has(a.trigger) && actions.has(a.action),
      );
      if (automators.length) {
        tx.insert(schema.automators)
          .values(
            automators.map((a) => ({
              name: a.name.trim(),
              enabled: true,
              trigger: a.trigger as (typeof AUTOMATOR_TRIGGERS)[number],
              conditions: (a.conditions ?? null) as Record<string, unknown> | null,
              action: a.action as (typeof AUTOMATOR_ACTIONS)[number],
              actionParams: (a.actionParams ?? null) as Record<string, unknown> | null,
            })),
          )
          .run();
      }

      let appliedFileRules = 0;
      if (rootId && fileRules.length) {
        const validRules = fileRules.filter((r) => events.has(r.event));
        if (validRules.length) {
          tx.insert(schema.fileRules)
            .values(
              validRules.map((r) => ({
                rootId: rootId as string,
                name: r.name.trim(),
                enabled: true,
                globPattern: r.globPattern.trim(),
                event: r.event as (typeof FILE_RULE_EVENTS)[number],
                notify: r.notify ?? null,
                message: r.message?.trim() || null,
                severity: (severities.has(r.severity ?? "")
                  ? (r.severity as FileRuleSeverity)
                  : "success") as FileRuleSeverity,
              })),
            )
            .run();
          appliedFileRules = validRules.length;
        }
      }

      tx.insert(schema.activities)
        .values({
          actorId: user.id,
          verb: "created",
          entityKind: "setting",
          entityId: template.id,
          summary: `${user.name} applied an AI-generated workflow "${tpl.name.trim()}"`,
          meta: {
            templateId: template.id,
            taskCount: tasks.length,
            automatorCount: automators.length,
            fileRuleCount: appliedFileRules,
            source: "ai-workflow",
          },
        })
        .run();

      return {
        templateId: template.id,
        taskCount: tasks.length,
        automatorCount: automators.length,
        fileRuleCount: appliedFileRules,
      };
    });

    broadcast("work_updated", { id: result.templateId });
    revalidatePath("/work/templates");
    revalidatePath("/settings");

    if (skipFileRules) {
      return {
        ok: false,
        error:
          "Workflow applied, but file rules were skipped: no watched folder is configured. Add one in Settings, then re-run.",
      };
    }
    return { ok: true, data: result };
  } catch {
    return { ok: false, error: "Failed to apply the workflow. No changes were made." };
  }
}
