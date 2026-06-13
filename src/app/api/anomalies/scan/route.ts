import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getCurrentUser, requireWrite } from "@/lib/auth";
import { scanTransactions, type ScanOptions } from "@/lib/anomaly/scan";
import type { NormalizedTxn, AnomalySource } from "@/lib/anomaly/rules";
import { generateSampleTxns, sampleReconciliationConfig } from "@/lib/anomaly/sample";
import { eq } from "drizzle-orm";

/**
 * POST /api/anomalies/scan
 *
 * Trigger a books-health scan for a client.
 *
 * Body:
 *   {
 *     organizationId: string,           // required
 *     txns?: NormalizedTxn[],           // transactions to scan
 *     source?: "quickbooks" | "statement" | "manual",
 *     config?: Partial<RuleConfig>,     // e.g. { expectedEndingBalanceCents }
 *     sample?: boolean                   // if true (or txns omitted), generate demo books
 *   }
 *
 * When no `txns` are supplied the route synthesizes a sample month of books so the
 * feature is demoable end-to-end without the live QuickBooks bridge. The real
 * integration agent will POST real NormalizedTxn[] from QB Desktop instead.
 *
 * Returns the ScanSummary.
 */
export async function POST(req: Request) {
  // requireWrite throws for readonly/unauthenticated; map to clean HTTP codes.
  try {
    await requireWrite();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FORBIDDEN";
    return NextResponse.json(
      { error: msg === "UNAUTHENTICATED" ? "Unauthorized" : "Forbidden" },
      { status: msg === "UNAUTHENTICATED" ? 401 : 403 },
    );
  }
  const user = await getCurrentUser();

  const body = (await req.json().catch(() => ({}))) as {
    organizationId?: string;
    txns?: NormalizedTxn[];
    source?: AnomalySource;
    config?: ScanOptions["config"];
    sample?: boolean;
  };

  const organizationId = body.organizationId;
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  // confirm the org exists (avoid FK insert errors / scanning ghosts)
  const [org] = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  if (!org) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const useSample = body.sample === true || !Array.isArray(body.txns) || body.txns.length === 0;

  let txns: NormalizedTxn[];
  let source: AnomalySource;
  let config = body.config;

  if (useSample) {
    txns = generateSampleTxns(organizationId);
    source = "quickbooks";
    // wire in a reconciliation drift for the demo if not provided
    config = { ...sampleReconciliationConfig(txns), ...(config ?? {}) };
  } else {
    txns = body.txns!;
    source = body.source ?? "quickbooks";
  }

  const summary = await scanTransactions(organizationId, txns, {
    source,
    config,
    actorId: user?.id ?? null,
  });

  return NextResponse.json({ ok: true, summary, sample: useSample });
}
