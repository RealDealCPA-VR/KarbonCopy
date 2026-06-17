import { handle, query, body } from "../_util";
import { listPayments, recordPayment } from "@/lib/api/services/billing";

// GET /api/v1/payments — list payments.
export const GET = (req: Request) =>
  handle(req, (actor) => listPayments(actor, query(req, ["invoiceId", "organizationId"])));

// POST /api/v1/payments — record a payment ({ invoiceId, amountCents, ... }).
export const POST = (req: Request) =>
  handle(req, async (actor) => recordPayment(actor, await body(req)), 201);
