/**
 * AI-native workflow generation.
 *
 * Given a plain-English description of an engagement and a snapshot of THIS
 * firm's configuration (statuses, work types, users), ask Claude to propose a
 * reviewable workflow plan: a work template + tasks + automators + file rules.
 *
 * Why this lives here and not in `src/lib/ai.ts`: `ai.ts` is the shared Claude
 * wrapper used by several modules and must not grow feature-specific schema
 * logic. We import the Anthropic SDK the same way `ai.ts` does (and reuse its
 * `aiEnabled()` gate + ANTHROPIC_MODEL env) so behaviour stays consistent.
 *
 * The Anthropic SDK pinned in this repo (^0.32.1) predates `messages.parse` /
 * `output_config`, so we force structured JSON via a single-tool call
 * (`tool_choice: {type: "tool"}`) and validate the result with Zod before it is
 * ever shown or applied.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { aiEnabled } from "@/lib/ai";
import type { AutomatorTrigger, AutomatorAction, FileRuleEvent } from "@/db/schema";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

/* ------------------------------------------------------------------ */
/* The implemented automator + file-rule vocabulary (must match the    */
/* engine in src/app/(app)/work/automators.ts and the schema enums).   */
/* ------------------------------------------------------------------ */

export const AUTOMATOR_TRIGGERS: readonly AutomatorTrigger[] = [
  "status_changed",
  "work_created",
  "task_completed",
  "due_approaching",
  "file_event",
  "all_tasks_done",
] as const;

export const AUTOMATOR_ACTIONS: readonly AutomatorAction[] = [
  "set_status",
  "assign",
  "notify",
  "create_task",
  "send_email",
  "create_work",
] as const;

export const FILE_RULE_EVENTS: readonly FileRuleEvent[] = [
  "add",
  "change",
  "unlink",
  "addDir",
] as const;

export const FILE_RULE_SEVERITIES = ["info", "success", "warning"] as const;

/* ------------------------------------------------------------------ */
/* Plan schema (the validated contract returned to callers).           */
/* ------------------------------------------------------------------ */

const workTemplateSchema = z.object({
  name: z.string().min(1),
  workTypeId: z.string().nullable().optional().default(null),
  recurrenceRule: z.string().nullable().optional().default(null),
  defaultBudgetMinutes: z.number().int().positive().nullable().optional().default(null),
});

const taskSchema = z.object({
  title: z.string().min(1),
  section: z.string().nullable().optional().default(null),
  dueOffsetDays: z.number().int().nullable().optional().default(null),
});

const automatorSchema = z.object({
  name: z.string().min(1),
  trigger: z.string().min(1),
  action: z.string().min(1),
  conditions: z.record(z.unknown()).nullable().optional().default(null),
  actionParams: z.record(z.unknown()).nullable().optional().default(null),
});

const fileRuleSchema = z.object({
  name: z.string().min(1),
  globPattern: z.string().min(1),
  event: z.string().min(1),
  notify: z.union([z.array(z.string()), z.string()]).nullable().optional().default(null),
  message: z.string().nullable().optional().default(null),
  severity: z.string().nullable().optional().default("success"),
});

const planSchema = z.object({
  summary: z.string().optional().default(""),
  workTemplate: workTemplateSchema,
  tasks: z.array(taskSchema).default([]),
  automators: z.array(automatorSchema).default([]),
  fileRules: z.array(fileRuleSchema).default([]),
});

export type WorkflowPlan = z.infer<typeof planSchema> & {
  /** Non-fatal warnings surfaced to the admin (e.g. dropped unknown triggers). */
  warnings: string[];
};

export type FirmContext = {
  firmName?: string | null;
  workTypes: Array<{ id: string; name: string; defaultBudgetMinutes?: number | null }>;
  statuses: Array<{ id: string; name: string; category: string }>;
  users: Array<{ id: string; name: string; role: string }>;
};

/* ------------------------------------------------------------------ */
/* Tool (JSON-schema) definition that forces structured output.        */
/* ------------------------------------------------------------------ */

const PLAN_TOOL: Anthropic.Tool = {
  name: "propose_workflow",
  description:
    "Return the proposed workflow plan for the described engagement, grounded in the firm's actual configuration.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One or two sentences describing what this workflow sets up.",
      },
      workTemplate: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short engagement template name, e.g. 'Monthly Bookkeeping'." },
          workTypeId: {
            type: ["string", "null"],
            description: "Must be one of the provided work type IDs, or null if none fit.",
          },
          recurrenceRule: {
            type: ["string", "null"],
            description:
              "iCal-ish RRULE string if the engagement recurs (e.g. 'FREQ=MONTHLY;BYMONTHDAY=15'), else null.",
          },
          defaultBudgetMinutes: {
            type: ["integer", "null"],
            description: "Estimated budget in minutes, or null.",
          },
        },
        required: ["name"],
      },
      tasks: {
        type: "array",
        description: "Ordered checklist of tasks for the engagement.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            section: { type: ["string", "null"], description: "Optional grouping heading." },
            dueOffsetDays: {
              type: ["integer", "null"],
              description: "Days after work start the task is due, or null.",
            },
          },
          required: ["title"],
        },
      },
      automators: {
        type: "array",
        description: "Rules that automate transitions for this workflow.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            trigger: { type: "string", enum: AUTOMATOR_TRIGGERS as unknown as string[] },
            action: { type: "string", enum: AUTOMATOR_ACTIONS as unknown as string[] },
            conditions: {
              type: ["object", "null"],
              description:
                "JSON conditions keyed by fromStatusId/toStatusId/workTypeId/priority/organizationId (use real IDs).",
            },
            actionParams: {
              type: ["object", "null"],
              description:
                "JSON params for the action, e.g. { statusId } for set_status, { assigneeId } for assign, { message, userId } for notify.",
            },
          },
          required: ["name", "trigger", "action"],
        },
      },
      fileRules: {
        type: "array",
        description: "File-server completion alert rules relevant to this engagement.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            globPattern: {
              type: "string",
              description: "Glob relative to a watched root, e.g. '**/Completed/**' or '**/*_FINAL.pdf'.",
            },
            event: { type: "string", enum: FILE_RULE_EVENTS as unknown as string[] },
            notify: {
              description: "JSON user IDs array, or one of the strings 'owner' | 'assignee' | 'all'.",
              anyOf: [
                { type: "array", items: { type: "string" } },
                { type: "string" },
                { type: "null" },
              ],
            },
            message: {
              type: ["string", "null"],
              description: "Notification template; supports {file} {client} {folder}.",
            },
            severity: { type: "string", enum: FILE_RULE_SEVERITIES as unknown as string[] },
          },
          required: ["name", "globPattern", "event"],
        },
      },
    },
    required: ["workTemplate", "tasks", "automators", "fileRules"],
  },
};

/* ------------------------------------------------------------------ */
/* Prompt construction                                                 */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(): string {
  return [
    "You are an operations architect for a CPA / accounting firm's practice-management system.",
    "Given a plain-English description of a client engagement, design a complete, ready-to-run workflow.",
    "You MUST ground every reference in the firm's ACTUAL configuration provided by the user:",
    "- Use real work type IDs, status IDs, and user IDs from the lists. Never invent IDs.",
    "- If nothing fits, use null rather than guessing.",
    "Constraints on the automator/file-rule vocabulary (anything outside these is invalid):",
    `- automator triggers: ${AUTOMATOR_TRIGGERS.join(", ")}`,
    `- automator actions: ${AUTOMATOR_ACTIONS.join(", ")}`,
    `- file rule events: ${FILE_RULE_EVENTS.join(", ")}`,
    `- file rule severities: ${FILE_RULE_SEVERITIES.join(", ")}`,
    "Design tasks as a realistic, sequenced checklist with sensible due offsets.",
    "Prefer a small number of high-value automators (e.g. notify on status change, set status when all tasks done).",
    "Only propose file rules when the engagement plausibly produces completion artifacts on the file server.",
    "Return your answer ONLY by calling the propose_workflow tool.",
  ].join("\n");
}

function buildUserPrompt(prompt: string, ctx: FirmContext): string {
  const fmt = (
    rows: Array<Record<string, unknown>>,
    cols: string[],
  ): string =>
    rows.length
      ? rows.map((r) => cols.map((c) => `${c}=${JSON.stringify(r[c] ?? null)}`).join("  ")).join("\n")
      : "(none configured)";

  return [
    ctx.firmName ? `Firm: ${ctx.firmName}` : "",
    "",
    "WORK TYPES (use these IDs for workTypeId):",
    fmt(ctx.workTypes, ["id", "name", "defaultBudgetMinutes"]),
    "",
    "WORK STATUSES (use these IDs for status conditions/params; category tells you the column meaning):",
    fmt(ctx.statuses, ["id", "name", "category"]),
    "",
    "USERS (use these IDs for assigneeId / notify):",
    fmt(ctx.users, ["id", "name", "role"]),
    "",
    "ENGAGEMENT TO SET UP:",
    prompt.trim(),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

function validateAgainstVocab(
  plan: z.infer<typeof planSchema>,
  ctx: FirmContext,
): WorkflowPlan {
  const warnings: string[] = [];
  const validWorkTypeIds = new Set(ctx.workTypes.map((w) => w.id));
  const validStatusIds = new Set(ctx.statuses.map((s) => s.id));
  const validUserIds = new Set(ctx.users.map((u) => u.id));

  // Work template: drop a hallucinated work type ID.
  if (plan.workTemplate.workTypeId && !validWorkTypeIds.has(plan.workTemplate.workTypeId)) {
    warnings.push(
      `Proposed work type "${plan.workTemplate.workTypeId}" is not configured — cleared.`,
    );
    plan.workTemplate.workTypeId = null;
  }

  // Automators: reject unknown triggers/actions; scrub bad IDs in conditions/params.
  const triggers = new Set<string>(AUTOMATOR_TRIGGERS);
  const actions = new Set<string>(AUTOMATOR_ACTIONS);
  plan.automators = plan.automators.filter((a) => {
    if (!triggers.has(a.trigger)) {
      warnings.push(`Automator "${a.name}" dropped: unknown trigger "${a.trigger}".`);
      return false;
    }
    if (!actions.has(a.action)) {
      warnings.push(`Automator "${a.name}" dropped: unknown action "${a.action}".`);
      return false;
    }
    const cond = (a.conditions ?? {}) as Record<string, unknown>;
    for (const key of ["fromStatusId", "toStatusId"]) {
      if (typeof cond[key] === "string" && !validStatusIds.has(cond[key] as string)) {
        warnings.push(`Automator "${a.name}": condition ${key} referenced an unknown status — cleared.`);
        delete cond[key];
      }
    }
    if (typeof cond.workTypeId === "string" && !validWorkTypeIds.has(cond.workTypeId as string)) {
      warnings.push(`Automator "${a.name}": condition workTypeId referenced an unknown work type — cleared.`);
      delete cond.workTypeId;
    }
    a.conditions = Object.keys(cond).length ? cond : null;

    const params = (a.actionParams ?? {}) as Record<string, unknown>;
    if (typeof params.statusId === "string" && !validStatusIds.has(params.statusId as string)) {
      warnings.push(`Automator "${a.name}": action statusId referenced an unknown status — cleared.`);
      delete params.statusId;
    }
    if (typeof params.assigneeId === "string" && !validUserIds.has(params.assigneeId as string)) {
      warnings.push(`Automator "${a.name}": action assigneeId referenced an unknown user — cleared.`);
      delete params.assigneeId;
    }
    if (typeof params.userId === "string" && !validUserIds.has(params.userId as string)) {
      warnings.push(`Automator "${a.name}": action userId referenced an unknown user — cleared.`);
      delete params.userId;
    }
    a.actionParams = Object.keys(params).length ? params : null;
    return true;
  });

  // File rules: reject unknown events; normalise severity.
  const events = new Set<string>(FILE_RULE_EVENTS);
  const severities = new Set<string>(FILE_RULE_SEVERITIES);
  plan.fileRules = plan.fileRules.filter((r) => {
    if (!events.has(r.event)) {
      warnings.push(`File rule "${r.name}" dropped: unknown event "${r.event}".`);
      return false;
    }
    if (!r.severity || !severities.has(r.severity)) {
      r.severity = "success";
    }
    return true;
  });

  return { ...plan, warnings };
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export class WorkflowAiError extends Error {}

/**
 * Generate a validated workflow plan from a plain-English prompt.
 * Throws WorkflowAiError("AI_DISABLED") when no API key is configured.
 */
export async function generateWorkflowPlan(
  prompt: string,
  firmContext: FirmContext,
): Promise<WorkflowPlan> {
  if (!aiEnabled()) throw new WorkflowAiError("AI_DISABLED");
  const trimmed = (prompt ?? "").trim();
  if (!trimmed) throw new WorkflowAiError("Describe the engagement first.");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: buildSystemPrompt(),
    tools: [PLAN_TOOL],
    tool_choice: { type: "tool", name: PLAN_TOOL.name },
    messages: [{ role: "user", content: buildUserPrompt(trimmed, firmContext) }],
  });

  const toolUse = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === PLAN_TOOL.name,
  );
  if (!toolUse) throw new WorkflowAiError("The AI did not return a structured plan. Try again.");

  const parsed = planSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new WorkflowAiError(
      `The AI plan failed validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  return validateAgainstVocab(parsed.data, firmContext);
}
