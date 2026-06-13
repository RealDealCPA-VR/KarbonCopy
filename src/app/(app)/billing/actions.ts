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
        quantity: Number.isFinite(quantity) ? quantity : 0,
        unitCents: Number.isFinite(unitCents) ? unitCents : 0,
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

  const [existing] = await db.select().from(invoices).where(eq(invoices.id, input.id)).limit(1);
  if (!existing) return { ok: false, error: "Invoice not found." };
  if (existing.status === "void") return { ok: false, error: "Voided invoices can't be edited." };
  if (existing.status === "paid") return { ok: false, error: "Paid invoices can't be edited." };

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
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status === "void") return { ok: false, error: "Voided invoices can't be sent." };

  const status = deriveStatus({
    current: "sent",
    totalCents: inv.totalCents,
    amountPaidCents: inv.amountPaidCents,
    dueDate: inv.dueDate,
  });

  db.transaction((tx) => {
    tx.update(invoices)
      .set({ status, sentAt: inv.sentAt ?? new Date(), updatedAt: new Date() })
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

  revalidateBilling(invoiceId);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Void (manager) / delete (manager)                                  */
/* ------------------------------------------------------------------ */

export async function voidInvoice(invoiceId: string): Promise<ActionResult> {
  const user = await requireManager();
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status === "paid") return { ok: false, error: "Paid invoices can't be voided." };

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

  revalidateBilling(invoiceId);
  return { ok: true };
}

export async function deleteInvoice(invoiceId: string): Promise<ActionResult> {
  const user = await requireManager();
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.amountPaidCents > 0) {
    return { ok: false, error: "Can't delete an invoice with recorded payments. Void it instead." };
  }

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
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status === "void") return { ok: false, error: "Can't record a payment on a voided invoice." };

  const amountCents = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: "Enter a payment amount greater than zero." };
  }

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  const newPaid = inv.amountPaidCents + amountCents;
  const status = deriveStatus({
    current: inv.status === "draft" ? "sent" : inv.status,
    totalCents: inv.totalCents,
    amountPaidCents: newPaid,
    dueDate: inv.dueDate,
  });

  const { paymentId } = db.transaction((tx) => {
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

    return { paymentId: p.id };
  });

  // Notify the client's relationship manager (full notifications row + emit).
  const rmId = await getOrgOwner(inv.organizationId);
  if (rmId && rmId !== user.id) {
    const [notif] = await db
      .insert(notifications)
      .values({
        userId: rmId,
        type: "payment",
        title: "Payment received",
        body: `A payment was recorded on invoice ${inv.number}.`,
        entityKind: "invoice",
        entityId: inv.id,
      })
      .returning();
    emitToUser(rmId, "notification", notif);
  }

  revalidateBilling(inv.id);
  return { ok: true, data: { status } };
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
  let totalCents = 0;
  for (const e of entries) {
    if (billedIds.has(e.id)) continue;
    if (!e.minutes) continue;
    const key = e.workItemId ?? "general";
    const rateCents = e.rateCents ?? 0;
    const amountCents = Math.round((e.minutes / 60) * rateCents);
    const label = e.workItemId ? (workTitles.get(e.workItemId) ?? "Work") : "Time & services";
    const g =
      byWork.get(key) ??
      ({ key, workItemId: e.workItemId ?? null, label, minutes: 0, amountCents: 0, rateCents, entryIds: [] } as WipGroup);
    g.minutes += e.minutes;
    g.amountCents += amountCents;
    g.entryIds.push(e.id);
    byWork.set(key, g);
    totalMinutes += e.minutes;
    totalCents += amountCents;
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

  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status === "void") return { ok: false, error: "Can't collect on a voided invoice." };
  if (inv.status === "paid") return { ok: false, error: "This invoice is already paid in full." };

  const due = Math.max(0, inv.totalCents - inv.amountPaidCents);
  if (due <= 0) return { ok: false, error: "Nothing left to collect on this invoice." };

  // Ensure a stable payToken exists for the public pay page + webhook correlation.
  let payToken = inv.payToken;
  if (!payToken) {
    payToken = newPayToken();
    await db.update(invoices).set({ payToken, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
  }

  let url: string;
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      success_url: `${appUrl()}/portal/pay/${payToken}?paid=1`,
      cancel_url: `${appUrl()}/portal/pay/${payToken}`,
      client_reference_id: inv.id,
      metadata: { invoiceId: inv.id, invoiceNumber: inv.number, payToken },
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

  await db.insert(activities).values({
    actorId: user.id,
    verb: "updated",
    entityKind: "invoice",
    entityId: inv.id,
    summary: `${user.name} generated a Stripe payment link for invoice ${inv.number}`,
  });

  revalidateBilling(inv.id);
  return { ok: true, data: { url } };
}
