"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireWrite, requireManager } from "@/lib/auth";
import { emitToUser } from "@/server/realtime";
import {
  computeTotals,
  deriveStatus,
  lineAmountCents,
  nextInvoiceNumber,
  newPayToken,
  stripeEnabled,
  stripe,
  appUrl,
  type LineInput,
} from "@/lib/billing";
import type { InvoiceStatus, PaymentMethod } from "@/db/schema";

const { invoices, invoiceLines, payments, organizations, timeEntries, activities, notifications } =
  schema;

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function nullable(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  if (!s || s === "none") return null;
  return s;
}

export type LineDraft = {
  description: string;
  quantity: number;
  unitCents: number;
  workItemId?: string | null;
  timeEntryIds?: string[] | null;
};

function sanitizeLines(raw: unknown): LineDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => {
      const description = String((l as any)?.description ?? "").trim();
      const quantity = Number((l as any)?.quantity);
      const unitCents = Math.round(Number((l as any)?.unitCents));
      return {
        description,
        // Clamp to >= 0: a negative quantity/price would produce a negative line
        // and could zero the invoice total (deriveStatus then marks it "paid").
        quantity: Number.isFinite(quantity) ? Math.max(0, quantity) : 0,
        unitCents: Number.isFinite(unitCents) ? Math.max(0, unitCents) : 0,
        workItemId: nullable((l as any)?.workItemId ?? null),
        timeEntryIds:
          Array.isArray((l as any)?.timeEntryIds) && (l as any).timeEntryIds.length
            ? ((l as any).timeEntryIds as string[])
            : null,
      };
    })
    .filter((l) => l.description.length > 0);
}

async function getOrgOwner(organizationId: string | null): Promise<string | null> {
  if (!organizationId) return null;
  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return org?.ownerId ?? null;
}

function revalidateBilling(invoiceId?: string) {
  revalidatePath("/billing");
  if (invoiceId) revalidatePath(`/billing/${invoiceId}`);
}

/* ------------------------------------------------------------------ */
/* Create invoice                                                     */
/* ------------------------------------------------------------------ */

export type CreateInvoiceInput = {
  organizationId?: string | null;
  contactId?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  terms?: string | null;
  taxBps?: number;
  discountCents?: number;
  status?: "draft" | "sent";
  lines: LineDraft[];
};

export async function createInvoice(
  input: CreateInvoiceInput,
): Promise<ActionResult<{ id: string; number: string }>> {
  const user = await requireWrite();

  const organizationId = nullable(input.organizationId);
  const contactId = nullable(input.contactId);
  if (!organizationId && !contactId) {
    return { ok: false, error: "Pick a client (organization or contact)." };
  }

  const lines = sanitizeLines(input.lines);
  if (lines.length === 0) {
    return { ok: false, error: "Add at least one line item with a description." };
  }

  const totals = computeTotals(lines as LineInput[], {
    taxBps: input.taxBps ?? 0,
    discountCents: input.discountCents ?? 0,
  });

  const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
  const dueDate = input.dueDate ? new Date(input.dueDate) : null;
  const status: InvoiceStatus = input.status === "sent" ? "sent" : "draft";

  // Insert invoice + its lines + activity atomically. better-sqlite3's
  // transaction callback MUST be synchronous — use sync terminals only.
  let result: { id: string; number: string };
  try {
    result = db.transaction((tx) => {
      const number = nextInvoiceNumber(tx);
      const [inv] = tx
        .insert(invoices)
        .values({
          number,
          organizationId,
          contactId,
          status,
          issueDate,
          dueDate,
          subtotalCents: totals.subtotalCents,
          taxCents: totals.taxCents,
          discountCents: totals.discountCents,
          totalCents: totals.totalCents,
          amountPaidCents: 0,
          notes: nullable(input.notes),
          terms: nullable(input.terms),
          sentAt: status === "sent" ? new Date() : null,
          createdById: user.id,
        })
        .returning({ id: invoices.id, number: invoices.number })
        .all();

      tx.insert(invoiceLines)
        .values(
          lines.map((l, i) => ({
            invoiceId: inv.id,
            description: l.description,
            quantity: l.quantity,
            unitCents: l.unitCents,
            amountCents: lineAmountCents(l.quantity, l.unitCents),
            workItemId: nullable(l.workItemId),
            timeEntryIds: l.timeEntryIds ?? null,
            position: i,
          })),
        )
        .run();

      tx.insert(activities)
        .values({
          actorId: user.id,
          verb: "created",
          entityKind: "invoice",
          entityId: inv.id,
          summary: `${user.name} created invoice ${number}`,
          meta: { total: totals.totalCents, status },
        })
        .run();

      return { id: inv.id, number: inv.number };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create invoice." };
  }

  revalidateBilling(result.id);
  return { ok: true, data: result };
}

/* ------------------------------------------------------------------ */
/* Update invoice (drafts / non-paid)                                 */
/* ------------------------------------------------------------------ */

export type UpdateInvoiceInput = CreateInvoiceInput & { id: string };

export async function updateInvoice(input: UpdateInvoiceInput): Promise<ActionResult> {
  const user = await requireWrite();
  if (!input.id) return { ok: false, error: "Missing invoice id." };

  let existing;
  try {
    [existing] = await db.select().from(invoices).where(eq(invoices.id, input.id)).limit(1);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load invoice." };
  }
  if (!existing) return { ok: false, error: "Invoice not found." };
  if (existing.status === "void") return { ok: false, error: "Voided invoices can't be edited." };
  if (existing.status === "paid") return { ok: false, error: "Paid invoices can't be edited." };
  // Editing an invoice that already has payments could drop its total below the
  // amount paid and derive a bogus "paid" status. Once money is recorded, the
  // invoice is locked — void and recreate instead (mirrors deleteInvoice).
  if (existing.amountPaidCents > 0) {
    return { ok: false, error: "Invoices with recorded payments can't be edited. Void and recreate instead." };
  }

  const lines = sanitizeLines(input.lines);
  if (lines.length === 0) {
    return { ok: false, error: "Add at least one line item with a description." };
  }

  const totals = computeTotals(lines as LineInput[], {
    taxBps: input.taxBps ?? 0,
    discountCents: input.discountCents ?? 0,
  });

  const organizationId = nullable(input.organizationId);
  const contactId = nullable(input.contactId);
  // issueDate is always present (the editor defaults it to today), so fall back
  // to the existing value. dueDate is OPTIONAL and the editor pre-fills it, so an
  // empty value here means the user intentionally cleared it → set null on purpose.
  const issueDate = input.issueDate ? new Date(input.issueDate) : existing.issueDate;
  const dueDate = input.dueDate ? new Date(input.dueDate) : null;

  // Status: keep sent/overdue/partial coherent with amounts & due date.
  const requestedStatus: InvoiceStatus =
    input.status === "sent" ? "sent" : existing.status === "draft" ? "draft" : existing.status;
  const status = deriveStatus({
    current: requestedStatus,
    totalCents: totals.totalCents,
    amountPaidCents: existing.amountPaidCents,
    dueDate,
  });

  try {
    db.transaction((tx) => {
      tx.update(invoices)
        .set({
          organizationId,
          contactId,
          status,
          issueDate,
          dueDate,
          subtotalCents: totals.subtotalCents,
          taxCents: totals.taxCents,
          discountCents: totals.discountCents,
          totalCents: totals.totalCents,
          notes: nullable(input.notes),
          terms: nullable(input.terms),
          sentAt:
            status !== "draft" && !existing.sentAt ? new Date() : existing.sentAt,
          // Stamp paidAt if this edit pushes the invoice to "paid" (e.g. a
          // zero-total invoice), matching the payment paths.
          paidAt: status === "paid" ? (existing.paidAt ?? new Date()) : existing.paidAt,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, input.id))
        .run();

      // Replace lines wholesale (cascade-free: delete then insert).
      tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, input.id)).run();
      tx.insert(invoiceLines)
        .values(
          lines.map((l, i) => ({
            invoiceId: input.id,
            description: l.description,
            quantity: l.quantity,
            unitCents: l.unitCents,
            amountCents: lineAmountCents(l.quantity, l.unitCents),
            workItemId: nullable(l.workItemId),
            timeEntryIds: l.timeEntryIds ?? null,
            position: i,
          })),
        )
        .run();

      tx.insert(activities)
        .values({
          actorId: user.id,
          verb: "updated",
          entityKind: "invoice",
          entityId: input.id,
          summary: `${user.name} updated invoice ${existing.number}`,
          meta: { total: totals.totalCents, status },
        })
        .run();
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update invoice." };
  }

  revalidateBilling(input.id);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Send / mark status                                                 */
/* ------------------------------------------------------------------ */

export async function sendInvoice(invoiceId: string): Promise<ActionResult> {
  const user = await requireWrite();
  let inv;
  try {
    [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load invoice." };
  }
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status === "void") return { ok: false, error: "Voided invoices can't be sent." };

  const status = deriveStatus({
    current: "sent",
    totalCents: inv.totalCents,
    amountPaidCents: inv.amountPaidCents,
    dueDate: inv.dueDate,
  });

  try {
    db.transaction((tx) => {
      tx.update(invoices)
        .set({
          status,
          sentAt: inv.sentAt ?? new Date(),
          paidAt: status === "paid" ? (inv.paidAt ?? new Date()) : inv.paidAt,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId))
        .run();
      tx.insert(activities)
        .values({
          actorId: user.id,
          verb: "updated",
          entityKind: "invoice",
          entityId: invoiceId,
          summary: `${user.name} marked invoice ${inv.number} as ${status}`,
          meta: { status },
        })
        .run();
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to send invoice." };
  }

  revalidateBilling(invoiceId);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Void (manager) / delete (manager)                                  */
/* ------------------------------------------------------------------ */

export async function voidInvoice(invoiceId: string): Promise<ActionResult> {
  const user = await requireManager();
  let inv;
  try {
    [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load invoice." };
  }
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status === "paid") return { ok: false, error: "Paid invoices can't be voided." };

  try {
    db.transaction((tx) => {
      tx.update(invoices)
        .set({ status: "void", updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId))
        .run();
      tx.insert(activities)
        .values({
          actorId: user.id,
          verb: "voided",
          entityKind: "invoice",
          entityId: invoiceId,
          summary: `${user.name} voided invoice ${inv.number}`,
        })
        .run();
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to void invoice." };
  }

  revalidateBilling(invoiceId);
  return { ok: true };
}

export async function deleteInvoice(invoiceId: string): Promise<ActionResult> {
  const user = await requireManager();
  let inv;
  try {
    [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load invoice." };
  }
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.amountPaidCents > 0) {
    return { ok: false, error: "Can't delete an invoice with recorded payments. Void it instead." };
  }

  try {
    db.transaction((tx) => {
      // invoiceLines cascade via FK onDelete: "cascade".
      tx.delete(invoices).where(eq(invoices.id, invoiceId)).run();
      tx.insert(activities)
        .values({
          actorId: user.id,
          verb: "deleted",
          entityKind: "invoice",
          entityId: invoiceId,
          summary: `${user.name} deleted invoice ${inv.number}`,
        })
        .run();
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete invoice." };
  }

  revalidatePath("/billing");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Record a manual payment                                            */
/* ------------------------------------------------------------------ */

export type RecordPaymentInput = {
  invoiceId: string;
  amountCents: number;
  method?: PaymentMethod;
  reference?: string | null;
  receivedAt?: string | null;
};

export async function recordPayment(input: RecordPaymentInput): Promise<ActionResult<{ status: InvoiceStatus }>> {
  const user = await requireWrite();

  const amountCents = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: "Enter a payment amount greater than zero." };
  }
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();

  // Read the invoice INSIDE the transaction and compute newPaid from the row read
  // there — otherwise two concurrent payments both read the old amountPaidCents
  // and the second update clobbers the first (lost update).
  type TxResult =
    | { kind: "ok"; status: InvoiceStatus; invoiceId: string; organizationId: string | null; number: string }
    | { kind: "notfound" }
    | { kind: "void" };
  let result: TxResult;
  try {
    result = db.transaction((tx): TxResult => {
      const inv = tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1).all()[0];
      if (!inv) return { kind: "notfound" };
      if (inv.status === "void") return { kind: "void" };

      const newPaid = inv.amountPaidCents + amountCents;
      const status = deriveStatus({
        current: inv.status === "draft" ? "sent" : inv.status,
        totalCents: inv.totalCents,
        amountPaidCents: newPaid,
        dueDate: inv.dueDate,
      });

      const [p] = tx
        .insert(payments)
        .values({
          invoiceId: inv.id,
          organizationId: inv.organizationId,
          amountCents,
          method: input.method ?? "manual",
          reference: nullable(input.reference),
          processor: "manual",
          receivedAt,
          createdById: user.id,
        })
        .returning({ id: payments.id })
        .all();
      if (!p) throw new Error("Payment could not be recorded.");

      tx.update(invoices)
        .set({
          amountPaidCents: newPaid,
          status,
          paidAt: status === "paid" ? (inv.paidAt ?? receivedAt) : inv.paidAt,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, inv.id))
        .run();

      tx.insert(activities)
        .values({
          actorId: user.id,
          verb: "recorded",
          entityKind: "payment",
          entityId: p.id,
          summary: `${user.name} recorded a payment on invoice ${inv.number}`,
          meta: { invoiceId: inv.id, amountCents, method: input.method ?? "manual", status },
        })
        .run();

      return { kind: "ok", status, invoiceId: inv.id, organizationId: inv.organizationId, number: inv.number };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to record payment." };
  }

  if (result.kind === "notfound") return { ok: false, error: "Invoice not found." };
  if (result.kind === "void") return { ok: false, error: "Can't record a payment on a voided invoice." };

  // Notify the client's relationship manager (full notifications row + emit).
  // Best-effort: the payment is already committed, so a notification failure must
  // not turn a successful payment into an error result.
  try {
    const rmId = await getOrgOwner(result.organizationId);
    if (rmId && rmId !== user.id) {
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: rmId,
          type: "payment",
          title: "Payment received",
          body: `A payment was recorded on invoice ${result.number}.`,
          entityKind: "invoice",
          entityId: result.invoiceId,
        })
        .returning();
      if (notif) emitToUser(rmId, "notification", notif);
    }
  } catch (err) {
    console.error("[billing] recordPayment notification failed:", err instanceof Error ? err.message : err);
  }

  revalidateBilling(result.invoiceId);
  return { ok: true, data: { status: result.status } };
}

/* ------------------------------------------------------------------ */
/* Invoice from WIP (unbilled, billable, approved time)               */
/* ------------------------------------------------------------------ */

export type WipGroup = {
  key: string; // workItemId or "general"
  workItemId: string | null;
  label: string;
  minutes: number;
  amountCents: number;
  rateCents: number;
  entryIds: string[];
};

/** Fallback hourly rate (cents) for entries with no explicit rate — must match
 *  the Time UI (time/page.tsx) so the WIP preview and invoice don't disagree. */
const DEFAULT_RATE_CENTS = 15000;

/** Pull a client's billable + approved time entries not yet on any invoice. */
export async function getUnbilledTime(organizationId: string): Promise<{
  groups: WipGroup[];
  totalMinutes: number;
  totalCents: number;
}> {
  await requireWrite();
  if (!organizationId) return { groups: [], totalMinutes: 0, totalCents: 0 };

  const entries = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.organizationId, organizationId),
        eq(timeEntries.billable, true),
        eq(timeEntries.approved, true),
        eq(timeEntries.running, false),
      ),
    )
    .orderBy(desc(timeEntries.date));

  // Exclude entries already rolled into a line on an existing (non-void) invoice.
  const billedIds = await getBilledEntryIds(organizationId);

  const byWork = new Map<string, WipGroup>();
  const workTitles = new Map<string, string>();

  const candidateWorkIds = Array.from(
    new Set(entries.map((e) => e.workItemId).filter((x): x is string => Boolean(x))),
  );
  if (candidateWorkIds.length) {
    const wis = await db
      .select({ id: schema.workItems.id, title: schema.workItems.title })
      .from(schema.workItems)
      .where(inArray(schema.workItems.id, candidateWorkIds));
    for (const w of wis) workTitles.set(w.id, w.title);
  }

  let totalMinutes = 0;
  for (const e of entries) {
    if (billedIds.has(e.id)) continue;
    if (!e.minutes) continue;
    const rateCents = e.rateCents ?? DEFAULT_RATE_CENTS;
    // Key by work item AND rate: entries on the same work item but at different
    // rates must not collapse into one group (the group carries a single rate,
    // which would otherwise misprice the invoice line).
    const key = `${e.workItemId ?? "general"}|${rateCents}`;
    const label = e.workItemId ? (workTitles.get(e.workItemId) ?? "Work") : "Time & services";
    const g =
      byWork.get(key) ??
      ({ key, workItemId: e.workItemId ?? null, label, minutes: 0, amountCents: 0, rateCents, entryIds: [] } as WipGroup);
    g.minutes += e.minutes;
    g.entryIds.push(e.id);
    byWork.set(key, g);
    totalMinutes += e.minutes;
  }

  // Compute each group's amount once from its summed minutes — round(hours × rate)
  // — so the preview total matches what the invoice editor bills for the same
  // group (it rebuilds the line from total hours × rate, not per-entry rounding).
  let totalCents = 0;
  for (const g of byWork.values()) {
    g.amountCents = Math.round((g.minutes / 60) * g.rateCents);
    totalCents += g.amountCents;
  }

  return { groups: Array.from(byWork.values()), totalMinutes, totalCents };
}

/** Collect time-entry ids already referenced by a line on a non-void invoice. */
async function getBilledEntryIds(organizationId: string): Promise<Set<string>> {
  const rows = await db
    .select({ ids: invoiceLines.timeEntryIds, status: invoices.status })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
    .where(eq(invoices.organizationId, organizationId));
  const set = new Set<string>();
  for (const r of rows) {
    if (r.status === "void") continue;
    for (const id of r.ids ?? []) set.add(id);
  }
  return set;
}

/* ------------------------------------------------------------------ */
/* Stripe checkout link                                               */
/* ------------------------------------------------------------------ */

export async function createCheckoutLink(invoiceId: string): Promise<ActionResult<{ url: string }>> {
  const user = await requireWrite();
  if (!stripeEnabled()) {
    return { ok: false, error: "Stripe is not configured. Set STRIPE_SECRET_KEY to enable card payments." };
  }

  let inv;
  try {
    [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load invoice." };
  }
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status === "void") return { ok: false, error: "Can't collect on a voided invoice." };
  if (inv.status === "paid") return { ok: false, error: "This invoice is already paid in full." };

  const due = Math.max(0, inv.totalCents - inv.amountPaidCents);
  if (due <= 0) return { ok: false, error: "Nothing left to collect on this invoice." };

  // Ensure a stable payToken exists for the public pay page + webhook correlation.
  let payToken = inv.payToken;
  if (!payToken) {
    payToken = newPayToken();
    try {
      await db.update(invoices).set({ payToken, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to prepare checkout." };
    }
  }

  let url: string;
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      success_url: `${appUrl()}/portal/pay/${payToken}?paid=1`,
      cancel_url: `${appUrl()}/portal/pay/${payToken}`,
      client_reference_id: inv.id,
      // Don't leak the capability payToken to Stripe's logs/dashboard — the
      // webhook reconciles on invoiceId / client_reference_id only.
      metadata: { invoiceId: inv.id, invoiceNumber: inv.number },
      payment_intent_data: { metadata: { invoiceId: inv.id, invoiceNumber: inv.number } },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: (inv.currency || "usd").toLowerCase(),
            unit_amount: due,
            product_data: { name: `Invoice ${inv.number}` },
          },
        },
      ],
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    url = session.url;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Stripe checkout could not be created.",
    };
  }

  try {
    await db.insert(activities).values({
      actorId: user.id,
      verb: "updated",
      entityKind: "invoice",
      entityId: inv.id,
      summary: `${user.name} generated a Stripe payment link for invoice ${inv.number}`,
    });
  } catch (err) {
    // The Stripe link is already created; an audit-log failure must not fail it.
    console.error("[billing] createCheckoutLink activity failed:", err instanceof Error ? err.message : err);
  }

  revalidateBilling(inv.id);
  return { ok: true, data: { url } };
}
