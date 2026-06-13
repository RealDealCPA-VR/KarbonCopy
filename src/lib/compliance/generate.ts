/**
 * Deadline generator.
 *
 * Walks client organizations, reads their `entityType` + `fiscalYearEnd`, and
 * upserts `complianceDeadlines` rows from the bundled ruleset (rules.ts) for the
 * relevant tax cycle(s). Idempotent on (organizationId, ruleKey, taxPeriod): a
 * re-run refreshes due dates without creating duplicates.
 *
 * Optionally creates a linked `workItem` per generated deadline so the deadline
 * shows up on the work board and can drive automators/scheduler.
 */
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Organization } from "@/db/schema";
import {
  parseFye,
  renderLabel,
  rulesForEntity,
  ruleByKey,
  type ComputedDeadline,
} from "./rules";

export type GenerateOptions = {
  /** Restrict to specific org ids (default: all non-deleted clients). */
  organizationIds?: string[];
  /** Restrict to specific jurisdictions (default: all bundled). */
  jurisdictions?: string[];
  /**
   * Tax years to generate. Default: the most recently completed tax year and
   * the current one (covers filing season + estimates).
   */
  taxYears?: number[];
  /** Also create/refresh a linked work item per generated deadline. */
  createWorkItems?: boolean;
  /** Actor id for activity logging (optional). */
  actorId?: string | null;
};

export type GenerateResult = {
  orgsProcessed: number;
  created: number;
  updated: number;
  workItemsCreated: number;
  skipped: number;
};

/** Sensible default tax-year window: last completed year + current year. */
function defaultTaxYears(now = new Date()): number[] {
  const y = now.getUTCFullYear();
  // Jan–Apr we still care about the prior-prior year's extensions, but keep it
  // simple & relevant: previous and current tax years.
  return [y - 1, y];
}

type DeadlineRow = typeof schema.complianceDeadlines.$inferSelect;

async function upsertWorkItemFor(
  org: Organization,
  name: string,
  dueDate: Date,
  existingWorkItemId: string | null,
): Promise<string | null> {
  // If a linked work item already exists, just keep its due date fresh.
  if (existingWorkItemId) {
    const [wi] = await db
      .select()
      .from(schema.workItems)
      .where(eq(schema.workItems.id, existingWorkItemId))
      .limit(1);
    if (wi) {
      await db
        .update(schema.workItems)
        .set({ dueDate, updatedAt: new Date() })
        .where(eq(schema.workItems.id, wi.id));
      return wi.id;
    }
  }

  // Default to the first status by position so it lands on the board.
  const [firstStatus] = await db
    .select()
    .from(schema.workStatuses)
    .orderBy(schema.workStatuses.position)
    .limit(1);

  const [created] = await db
    .insert(schema.workItems)
    .values({
      title: name,
      organizationId: org.id,
      statusId: firstStatus?.id ?? null,
      assigneeId: org.ownerId ?? null,
      dueDate,
      priority: "normal",
    })
    .returning();
  return created?.id ?? null;
}

/**
 * Generate / refresh deadlines for the given options.
 * Safe to call repeatedly (e.g. from the scheduler or the /deadlines UI action).
 */
export async function generateDeadlines(
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const result: GenerateResult = {
    orgsProcessed: 0,
    created: 0,
    updated: 0,
    workItemsCreated: 0,
    skipped: 0,
  };

  const taxYears = opts.taxYears?.length ? opts.taxYears : defaultTaxYears();

  // Load target client orgs.
  let orgs = await db
    .select()
    .from(schema.organizations)
    .where(and(eq(schema.organizations.isClient, true), isNull(schema.organizations.deletedAt)));

  if (opts.organizationIds?.length) {
    const set = new Set(opts.organizationIds);
    orgs = orgs.filter((o) => set.has(o.id));
  }

  for (const org of orgs) {
    result.orgsProcessed++;
    const fye = parseFye(org.fiscalYearEnd);
    const rules = rulesForEntity(org.entityType, opts.jurisdictions);
    if (!rules.length) {
      result.skipped++;
      continue;
    }

    // Existing rows for this org, indexed by ruleKey|taxPeriod for idempotency.
    const existing = await db
      .select()
      .from(schema.complianceDeadlines)
      .where(eq(schema.complianceDeadlines.organizationId, org.id));
    const existingByKey = new Map<string, DeadlineRow>();
    for (const row of existing) {
      existingByKey.set(`${row.ruleKey ?? ""}|${row.taxPeriod ?? ""}`, row);
    }

    for (const rule of rules) {
      for (const taxYear of taxYears) {
        let computed: ComputedDeadline[];
        try {
          const raw = rule.compute({ taxYear, fye });
          computed = Array.isArray(raw) ? raw : [raw];
        } catch (err) {
          console.error(`[compliance] rule ${rule.key} failed for ${org.name}:`, err);
          continue;
        }

        for (const c of computed) {
          const taxPeriod = c.taxPeriod ?? String(taxYear);
          const name = renderLabel(rule, taxPeriod);
          const idemKey = `${rule.key}|${taxPeriod}`;
          const prior = existingByKey.get(idemKey);

          // Preserve manual status changes (filed/extended/etc.) — only the
          // generator's own "upcoming" rows get their dates refreshed.
          if (prior) {
            const datesChanged =
              prior.dueDate?.getTime() !== c.dueDate.getTime() ||
              (prior.extendedDueDate?.getTime() ?? null) !== (c.extendedDueDate?.getTime() ?? null);

            let workItemId = prior.workItemId;
            if (opts.createWorkItems) {
              workItemId = await upsertWorkItemFor(
                org,
                name,
                c.extendedDueDate ?? c.dueDate,
                prior.workItemId,
              );
              if (workItemId && !prior.workItemId) result.workItemsCreated++;
            }

            if (datesChanged || workItemId !== prior.workItemId) {
              await db
                .update(schema.complianceDeadlines)
                .set({
                  name,
                  dueDate: c.dueDate,
                  extendedDueDate: c.extendedDueDate,
                  workItemId,
                })
                .where(eq(schema.complianceDeadlines.id, prior.id));
              result.updated++;
            } else {
              result.skipped++;
            }
            continue;
          }

          // New deadline.
          let workItemId: string | null = null;
          if (opts.createWorkItems) {
            workItemId = await upsertWorkItemFor(org, name, c.extendedDueDate ?? c.dueDate, null);
            if (workItemId) result.workItemsCreated++;
          }

          await db.insert(schema.complianceDeadlines).values({
            organizationId: org.id,
            name,
            jurisdiction: rule.jurisdiction,
            form: rule.form,
            taxPeriod,
            dueDate: c.dueDate,
            extendedDueDate: c.extendedDueDate,
            status: "upcoming",
            workItemId,
            ruleKey: rule.key,
            autoGenerated: true,
          });
          result.created++;
        }
      }
    }
  }

  if (result.created || result.updated) {
    await db.insert(schema.activities).values({
      actorId: opts.actorId ?? null,
      verb: "generated",
      entityKind: "deadline",
      entityId: "compliance",
      summary: `Generated ${result.created} and refreshed ${result.updated} compliance deadline(s)`,
      meta: { ...result },
    });
  }

  return result;
}

/** Re-export so callers (scheduler) can resolve a rule from a stored deadline. */
export { ruleByKey };
