/**
 * Billing service — invoices + payments. Mirrors the organizations exemplar.
 * Pure: explicit actor, RBAC, zod validation, activity logging, plain returns.
 * Money is integer cents throughout.
 */
import { z } from "zod";
import { and, desc, eq, like } from "drizzle-orm";
import { db, schema, type Actor, requireWrite, parse, logActivity, pagination } from "./_base";
import { notFound, validation } from "@/lib/api/errors";
import type { InvoiceStatus } from "@/db/schema";

const { invoices, invoiceLines, payments, organizations } = schema;

const dateCoerce = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

const PAYMENT_METHODS = ["card", "ach", "check", "cash", "wire", "manual"] as const;

const lineInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().min(0).default(1),
  unitCents: z.number().int(),
});

const createInvoiceInput = z.object({
  organizationId: z.string().trim().min(1),
  issueDate: dateCoerce.optional(),
  dueDate: dateCoerce.optional(),
  lines: z.array(lineInput).min(1),
  taxCents: z.number().int().min(0).default(0),
  discountCents: z.number().int().min(0).default(0),
  notes: z.string().max(5000).optional(),
  terms: z.string().max(2000).optional(),
});

const recordPaymentInput = z.object({
  invoiceId: z.string().trim().min(1),
  amountCents: z.number().int().min(1),
  method: z.enum(PAYMENT_METHODS).default("manual"),
  reference: z.string().trim().max(200).optional(),
});

const listInvoicesInput = pagination.extend({
  organizationId: z.string().trim().min(1).optional(),
  status: z
    .enum(["draft", "sent", "partial", "paid", "void", "overdue"])
    .optional(),
});

const listPaymentsInput = pagination.extend({
  invoiceId: z.string().trim().min(1).optional(),
  organizationId: z.string().trim().min(1).optional(),
});

function presentInvoice(inv: typeof invoices.$inferSelect, lines?: Array<typeof invoiceLines.$inferSelect>) {
  return {
    id: inv.id,
    number: inv.number,
    organizationId: inv.organizationId,
    contactId: inv.contactId,
    status: inv.status,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    subtotalCents: inv.subtotalCents,
    taxCents: inv.taxCents,
    discountCents: inv.discountCents,
    totalCents: inv.totalCents,
    amountPaidCents: inv.amountPaidCents,
    currency: inv.currency,
    notes: inv.notes,
    terms: inv.terms,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
    ...(lines
      ? {
          lines: lines.map((l) => ({
            id: l.id,
            description: l.description,
            quantity: l.quantity,
            unitCents: l.unitCents,
            amountCents: l.amountCents,
            position: l.position,
          })),
        }
      : {}),
  };
}

function presentPayment(p: typeof payments.$inferSelect) {
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    organizationId: p.organizationId,
    amountCents: p.amountCents,
    method: p.method,
    reference: p.reference,
    receivedAt: p.receivedAt,
    createdAt: p.createdAt,
  };
}

async function assertOrg(id: string) {
  const [r] = await db.select({ id: organizations.id, deletedAt: organizations.deletedAt }).from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!r || r.deletedAt) throw validation(`Organization ${id} not found`);
}

export async function listInvoices(actor: Actor, input: unknown = {}) {
  const { limit, offset, search, organizationId, status } = parse(listInvoicesInput, input);
  const where = and(
    organizationId ? eq(invoices.organizationId, organizationId) : undefined,
    status ? eq(invoices.status, status) : undefined,
    search ? like(invoices.number, `%${search}%`) : undefined,
  );
  const rows = await db
    .select()
    .from(invoices)
    .where(where)
    .orderBy(desc(invoices.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => presentInvoice(r));
}

export async function getInvoice(actor: Actor, id: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!inv) throw notFound("Invoice");
  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, id))
    .orderBy(invoiceLines.position);
  return presentInvoice(inv, lines);
}

export async function createInvoice(actor: Actor, input: unknown) {
  requireWrite(actor);
  const data = parse(createInvoiceInput, input);
  await assertOrg(data.organizationId);

  // Compute totals in integer cents.
  const lineRows = data.lines.map((l, i) => {
    const amountCents = Math.round(l.quantity * l.unitCents);
    return {
      description: l.description,
      quantity: l.quantity,
      unitCents: l.unitCents,
      amountCents,
      position: i,
    };
  });
  const subtotalCents = lineRows.reduce((sum, l) => sum + l.amountCents, 0);
  const totalCents = subtotalCents + data.taxCents - data.discountCents;
  if (totalCents < 0) throw validation("Invoice total cannot be negative");

  const year = (data.issueDate ?? new Date()).getFullYear();
  const prefix = `INV-${year}-`;

  // Sequential number + insert atomically. Callback MUST be synchronous.
  const result = db.transaction((tx) => {
    const yearInvoices = tx
      .select({ number: invoices.number })
      .from(invoices)
      .where(like(invoices.number, `${prefix}%`))
      .all();
    let maxSeq = 0;
    for (const r of yearInvoices) {
      const seq = Number.parseInt(r.number.slice(prefix.length), 10);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    }
    const number = `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;

    const [inv] = tx
      .insert(invoices)
      .values({
        number,
        organizationId: data.organizationId,
        status: "draft" as InvoiceStatus,
        issueDate: data.issueDate ?? null,
        dueDate: data.dueDate ?? null,
        subtotalCents,
        taxCents: data.taxCents,
        discountCents: data.discountCents,
        totalCents,
        notes: data.notes || null,
        terms: data.terms || null,
        createdById: actor.id,
      })
      .returning()
      .all();

    const insertedLines = tx
      .insert(invoiceLines)
      .values(lineRows.map((l) => ({ ...l, invoiceId: inv.id })))
      .returning()
      .all();

    return { inv, lines: insertedLines };
  });

  await logActivity({
    actorId: actor.id, verb: "created", entityKind: "invoice", entityId: result.inv.id,
    summary: `${actor.name} created invoice ${result.inv.number} (via API)`,
  });
  return presentInvoice(result.inv, result.lines);
}

export async function recordPayment(actor: Actor, input: unknown) {
  requireWrite(actor);
  const data = parse(recordPaymentInput, input);
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, data.invoiceId)).limit(1);
  if (!inv) throw notFound("Invoice");

  const newPaid = inv.amountPaidCents + data.amountCents;
  let status: InvoiceStatus = inv.status;
  if (newPaid >= inv.totalCents && inv.totalCents > 0) status = "paid";
  else if (newPaid > 0) status = "partial";
  const now = new Date();

  const [pay] = await db
    .insert(payments)
    .values({
      invoiceId: inv.id,
      organizationId: inv.organizationId,
      amountCents: data.amountCents,
      method: data.method,
      reference: data.reference || null,
      createdById: actor.id,
    })
    .returning();

  await db
    .update(invoices)
    .set({
      amountPaidCents: newPaid,
      status,
      paidAt: status === "paid" ? now : inv.paidAt,
      updatedAt: now,
    })
    .where(eq(invoices.id, inv.id));

  await logActivity({
    actorId: actor.id, verb: "created", entityKind: "payment", entityId: pay.id,
    summary: `${actor.name} recorded a ${data.amountCents}¢ payment on invoice ${inv.number} (via API)`,
  });
  return presentPayment(pay);
}

export async function listPayments(actor: Actor, input: unknown = {}) {
  const { limit, offset, invoiceId, organizationId } = parse(listPaymentsInput, input);
  const where = and(
    invoiceId ? eq(payments.invoiceId, invoiceId) : undefined,
    organizationId ? eq(payments.organizationId, organizationId) : undefined,
  );
  const rows = await db
    .select()
    .from(payments)
    .where(where)
    .orderBy(desc(payments.receivedAt))
    .limit(limit)
    .offset(offset);
  return rows.map(presentPayment);
}
