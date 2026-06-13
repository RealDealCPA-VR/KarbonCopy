/**
 * Books-health anomaly radar — scan orchestrator.
 *
 * `scanTransactions(orgId, txns)` is the single entry point the QuickBooks
 * integration (or a parsed-statement adapter) calls. It:
 *   1. runs the pure rules in `rules.ts`,
 *   2. dedupes candidates against existing OPEN anomalies (by `meta.signature`),
 *   3. inserts only genuinely-new findings,
 *   4. notifies the client's relationship manager on new *critical* anomalies,
 *   5. returns a summary.
 *
 * It is idempotent: re-running the same txns produces no new rows. Pure detection
 * lives in `rules.ts`; this file owns all DB / notification side-effects.
 *
 * NOTE: this module does NOT import the QuickBooks helper. It works on ANY
 * NormalizedTxn[] so a thin adapter can be wired later without coupling builds.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Anomaly } from "@/db/schema";
import { emitToUser, broadcast } from "@/server/realtime";
import {
  runAllRules,
  DEFAULT_RULE_CONFIG,
  type AnomalyCandidate,
  type AnomalySource,
  type NormalizedTxn,
  type RuleConfig,
} from "./rules";

const { anomalies, organizations, notifications, activities } = schema;

export type ScanOptions = {
  /** Where these txns came from. Stored on each anomaly row. Default "quickbooks". */
  source?: AnomalySource;
  /** Override detection thresholds (e.g. supply expectedEndingBalanceCents). */
  config?: Partial<RuleConfig>;
  /** Actor id for the activity log (the user who triggered the scan), if any. */
  actorId?: string | null;
};

export type ScanSummary = {
  organizationId: string;
  scanned: number;
  candidates: number;
  /** Newly-inserted anomalies. */
  created: number;
  /** Candidates skipped because an open anomaly with the same signature exists. */
  duplicates: number;
  /** Of `created`, how many were critical (and thus notified). */
  critical: number;
  byKind: Record<string, number>;
  bySeverity: Record<string, number>;
  /** Ids of the inserted anomaly rows. */
  createdIds: string[];
};

function emptySummary(orgId: string, scanned: number): ScanSummary {
  return {
    organizationId: orgId,
    scanned,
    candidates: 0,
    created: 0,
    duplicates: 0,
    critical: 0,
    byKind: {},
    bySeverity: {},
    createdIds: [],
  };
}

/** Pull the `meta.signature` out of a candidate (always present). */
function sigOf(c: AnomalyCandidate): string {
  return c.meta.signature;
}

/**
 * Scan a client's transactions, persist new anomalies, notify the RM on criticals.
 * Idempotent against currently-open anomalies for the same org.
 */
export async function scanTransactions(
  organizationId: string,
  txns: NormalizedTxn[],
  opts: ScanOptions = {},
): Promise<ScanSummary> {
  const source: AnomalySource = opts.source ?? "quickbooks";
  const cfg: RuleConfig = { ...DEFAULT_RULE_CONFIG, ...(opts.config ?? {}) };

  if (!organizationId) return emptySummary(organizationId, txns.length);

  const candidates = runAllRules(txns, cfg);
  const summary = emptySummary(organizationId, txns.length);
  summary.candidates = candidates.length;
  if (candidates.length === 0) return summary;

  // Collapse duplicate signatures within this single scan (a rule could, in
  // theory, emit the same signature twice — keep the highest-severity copy).
  const sevRank: Record<string, number> = { info: 0, warning: 1, critical: 2 };
  const bySig = new Map<string, AnomalyCandidate>();
  for (const c of candidates) {
    const existing = bySig.get(sigOf(c));
    if (!existing || sevRank[c.severity] > sevRank[existing.severity]) {
      bySig.set(sigOf(c), c);
    }
  }
  const unique = [...bySig.values()];

  // Dedupe against existing OPEN anomalies for this org by signature.
  const existingOpen = await db
    .select({ id: anomalies.id, meta: anomalies.meta })
    .from(anomalies)
    .where(and(eq(anomalies.organizationId, organizationId), eq(anomalies.status, "open")));

  const openSignatures = new Set<string>();
  for (const row of existingOpen) {
    const sig = (row.meta as { signature?: string } | null)?.signature;
    if (sig) openSignatures.add(sig);
  }

  const toInsert = unique.filter((c) => !openSignatures.has(sigOf(c)));
  summary.duplicates = unique.length - toInsert.length;

  if (toInsert.length === 0) return summary;

  // Insert all new anomalies in one transaction.
  const inserted = db.transaction((tx) => {
    return tx
      .insert(anomalies)
      .values(
        toInsert.map((c) => ({
          organizationId,
          source,
          kind: c.kind,
          severity: c.severity,
          title: c.title,
          detail: c.detail,
          amountCents: c.amountCents ?? null,
          status: "open" as const,
          meta: c.meta as Record<string, unknown>,
        })),
      )
      .returning()
      .all();
  });

  summary.created = inserted.length;
  summary.createdIds = inserted.map((r) => r.id);
  for (const r of inserted) {
    summary.byKind[r.kind] = (summary.byKind[r.kind] ?? 0) + 1;
    summary.bySeverity[r.severity] = (summary.bySeverity[r.severity] ?? 0) + 1;
  }
  const criticals = inserted.filter((r) => r.severity === "critical");
  summary.critical = criticals.length;

  // Activity log (best-effort).
  try {
    await db.insert(activities).values({
      actorId: opts.actorId ?? null,
      verb: "created",
      entityKind: "anomaly",
      entityId: summary.createdIds[0],
      summary: `Books-health scan flagged ${summary.created} new anomal${
        summary.created === 1 ? "y" : "ies"
      }${summary.critical ? ` (${summary.critical} critical)` : ""}`,
      meta: {
        organizationId,
        source,
        byKind: summary.byKind,
        bySeverity: summary.bySeverity,
      },
    });
  } catch {
    /* activity logging is best-effort */
  }

  // Notify the client's relationship manager on new critical anomalies.
  if (criticals.length > 0) {
    await notifyRelationshipManager(organizationId, criticals);
  }

  // Nudge any live radar views to refresh.
  broadcast("anomaly_scan", {
    organizationId,
    created: summary.created,
    critical: summary.critical,
  });

  return summary;
}

/** Create a full notifications row + realtime push for the org's RM on criticals. */
async function notifyRelationshipManager(
  organizationId: string,
  criticals: Anomaly[],
): Promise<void> {
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name, ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!org?.ownerId) return; // no RM assigned — nothing to notify

  const count = criticals.length;
  const lead = criticals[0];
  const title =
    count === 1
      ? `Critical books anomaly — ${org.name}`
      : `${count} critical books anomalies — ${org.name}`;
  const body = count === 1 ? lead.title : `${lead.title} (+${count - 1} more)`;

  const [notif] = await db
    .insert(notifications)
    .values({
      userId: org.ownerId,
      type: "anomaly",
      title,
      body,
      entityKind: "anomaly",
      // deep-link to the lead anomaly; the radar filters by org via query param too
      entityId: lead.id,
    })
    .returning();

  if (notif) emitToUser(org.ownerId, "notification", notif);
}
