/**
 * Billing core — Stripe (optional, lazily constructed), invoice number
 * generation, money math, and status derivation. Shared by server actions,
 * API routes, and the Stripe webhook.
 *
 * Money is integer cents everywhere. Stripe is OPTIONAL: if STRIPE_SECRET_KEY
 * is unset, `stripeEnabled()` is false and checkout flows degrade gracefully
 * (mirrors lib/ai.ts's aiEnabled pattern). No card data ever touches this app.
 */
import "server-only";
import Stripe from "stripe";
import { and, desc, eq, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import type { Invoice, InvoiceStatus } from "@/db/schema";

const { invoices } = schema;

/* ------------------------------------------------------------------ */
/* Stripe (optional)                                                  */
/* ------------------------------------------------------------------ */

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let _stripe: Stripe | null = null;

/** Lazily construct a Stripe client. Throws STRIPE_DISABLED when unconfigured. */
export function stripe(): Stripe {
  if (!stripeEnabled()) throw new Error("STRIPE_DISABLED");
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // Pin nothing exotic — let the installed SDK default its apiVersion.
      appInfo: { name: "KarbonCopy" },
    });
  }
  return _stripe;
}

/** Public base URL clients reach (for Checkout success/cancel + pay links). */
export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

/* ------------------------------------------------------------------ */
/* Money math                                                         */
/* ------------------------------------------------------------------ */

export type LineInput = {
  description: string;
  quantity: number;
  unitCents: number;
};

/** Round a line's quantity × unit to whole cents. */
export function lineAmountCents(quantity: number, unitCents: number): number {
  return Math.round((Number(quantity) || 0) * (Number(unitCents) || 0));
}

export type Totals = {
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
};

/**
 * Compute invoice totals from lines + a tax rate (basis points, e.g. 825 = 8.25%)
 * and a flat discount in cents. Tax is applied to (subtotal − discount), floored at 0.
 */
export function computeTotals(
  lines: LineInput[],
  opts: { taxBps?: number; discountCents?: number } = {},
): Totals {
  const subtotalCents = lines.reduce(
    (sum, l) => sum + lineAmountCents(l.quantity, l.unitCents),
    0,
  );
  const discountCents = Math.max(0, Math.min(opts.discountCents ?? 0, subtotalCents));
  const taxable = Math.max(0, subtotalCents - discountCents);
  const taxCents = Math.max(0, Math.round((taxable * (opts.taxBps ?? 0)) / 10000));
  const totalCents = Math.max(0, taxable + taxCents);
  return { subtotalCents, taxCents, discountCents, totalCents };
}

/** Derive tax basis points from stored tax/subtotal/discount (for edit prefills). */
export function deriveTaxBps(inv: Pick<Invoice, "subtotalCents" | "taxCents" | "discountCents">): number {
  const taxable = Math.max(0, inv.subtotalCents - inv.discountCents);
  if (taxable <= 0) return 0;
  return Math.round((inv.taxCents / taxable) * 10000);
}

/* ------------------------------------------------------------------ */
/* Status                                                             */
/* ------------------------------------------------------------------ */

/**
 * Derive the payment-driven status for an invoice from amounts + due date.
 * Never overrides terminal states (void). Draft stays draft until sent.
 */
export function deriveStatus(opts: {
  current: InvoiceStatus;
  totalCents: number;
  amountPaidCents: number;
  dueDate: Date | null;
  now?: Date;
}): InvoiceStatus {
  const { current, totalCents, amountPaidCents } = opts;
  if (current === "void") return "void";
  if (current === "draft") return "draft";

  // A zero/negative total is fully satisfied; otherwise fully paid when covered.
  if (totalCents <= 0 || amountPaidCents >= totalCents) return "paid";
  if (amountPaidCents > 0) return "partial";

  // No payment yet → sent, but flip to overdue once past due.
  const now = opts.now ?? new Date();
  if (opts.dueDate && opts.dueDate.getTime() < now.getTime()) return "overdue";
  return "sent";
}

/* ------------------------------------------------------------------ */
/* Invoice numbering                                                  */
/* ------------------------------------------------------------------ */

/**
 * Next sequential invoice number for the current year: INV-YYYY-####.
 * Best-effort highest-suffix scan; the unique index on `number` is the real
 * guard. Pass an active transaction handle so the read happens inside the
 * same tx as the insert.
 */
export function nextInvoiceNumber(
  tx: { select: typeof db.select } = db,
  year = new Date().getFullYear(),
): string {
  const prefix = `INV-${year}-`;
  const rows = (tx.select({ number: invoices.number }).from(invoices) as any)
    .where(like(invoices.number, `${prefix}%`))
    .orderBy(desc(invoices.number))
    .limit(1)
    .all() as Array<{ number: string }>;

  let next = 1;
  if (rows[0]?.number) {
    const suffix = rows[0].number.slice(prefix.length);
    const n = parseInt(suffix, 10);
    if (Number.isFinite(n)) next = n + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

/** High-entropy public pay-link token (matches portal magic-token entropy). */
export function newPayToken(): string {
  return nanoid(32);
}

/* ------------------------------------------------------------------ */
/* Lookups                                                            */
/* ------------------------------------------------------------------ */

export async function findInvoiceByPayToken(token: string): Promise<Invoice | null> {
  if (!token) return null;
  const [row] = await db.select().from(invoices).where(eq(invoices.payToken, token)).limit(1);
  return row ?? null;
}

export async function findInvoiceById(id: string): Promise<Invoice | null> {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  return row ?? null;
}

/** Has this Stripe processor reference already been recorded? (webhook idempotency) */
export async function paymentExistsForRef(processorRef: string): Promise<boolean> {
  if (!processorRef) return false;
  const [row] = await db
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(and(eq(schema.payments.processorRef, processorRef), eq(schema.payments.processor, "stripe")))
    .limit(1);
  return Boolean(row);
}

/* ------------------------------------------------------------------ */
/* Apply a Stripe payment (webhook)                                   */
/* ------------------------------------------------------------------ */

export type ApplyStripeResult =
  | { applied: false; reason: "no_invoice" | "duplicate" | "void" }
  | { applied: true; invoiceId: string; status: InvoiceStatus; rmId: string | null; number: string };

/**
 * Idempotently record a Stripe payment against an invoice and recompute its
 * status. Idempotent on `processorRef` (Stripe payment_intent / session id).
 * Synchronous body inside the transaction (better-sqlite3 requirement).
 */
export function applyStripePayment(opts: {
  invoiceId: string;
  amountCents: number;
  processorRef: string;
  reference?: string | null;
}): ApplyStripeResult {
  const { payments, activities } = schema;

  return db.transaction((tx): ApplyStripeResult => {
    const inv = tx.select().from(invoices).where(eq(invoices.id, opts.invoiceId)).limit(1).all()[0];
    if (!inv) return { applied: false, reason: "no_invoice" };
    if (inv.status === "void") return { applied: false, reason: "void" };

    // Idempotency: bail if we've already recorded this processor ref.
    const dup = tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.processorRef, opts.processorRef), eq(payments.processor, "stripe")))
      .limit(1)
      .all()[0];
    if (dup) return { applied: false, reason: "duplicate" };

    const amountCents = Math.max(0, Math.round(opts.amountCents));
    const newPaid = inv.amountPaidCents + amountCents;
    const status = deriveStatus({
      current: inv.status === "draft" ? "sent" : inv.status,
      totalCents: inv.totalCents,
      amountPaidCents: newPaid,
      dueDate: inv.dueDate,
    });
    const now = new Date();

    const [p] = tx
      .insert(payments)
      .values({
        invoiceId: inv.id,
        organizationId: inv.organizationId,
        amountCents,
        method: "card",
        reference: opts.reference ?? null,
        processor: "stripe",
        processorRef: opts.processorRef,
        receivedAt: now,
      })
      .returning({ id: payments.id })
      .all();
    if (!p) throw new Error("Payment could not be recorded.");

    tx.update(invoices)
      .set({
        amountPaidCents: newPaid,
        status,
        paidAt: status === "paid" ? (inv.paidAt ?? now) : inv.paidAt,
        updatedAt: now,
      })
      .where(eq(invoices.id, inv.id))
      .run();

    tx.insert(activities)
      .values({
        actorId: null,
        verb: "recorded",
        entityKind: "payment",
        entityId: p.id,
        summary: `Stripe payment received on invoice ${inv.number}`,
        meta: { invoiceId: inv.id, amountCents, processorRef: opts.processorRef, status },
      })
      .run();

    return { applied: true, invoiceId: inv.id, status, rmId: null, number: inv.number };
  });
}
