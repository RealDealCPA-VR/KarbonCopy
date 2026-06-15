import { handle } from "../../_util";
import { getInvoice } from "@/lib/api/services/billing";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/invoices/[id]
export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => getInvoice(actor, (await params).id));
