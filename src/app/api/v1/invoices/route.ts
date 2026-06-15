import { handle, query, body } from "../_util";
import { listInvoices, createInvoice } from "@/lib/api/services/billing";

// GET /api/v1/invoices — list invoices.
export const GET = (req: Request) =>
  handle(req, (actor) => listInvoices(actor, query(req)));

// POST /api/v1/invoices — create an invoice.
export const POST = (req: Request) =>
  handle(req, async (actor) => createInvoice(actor, await body(req)), 201);
