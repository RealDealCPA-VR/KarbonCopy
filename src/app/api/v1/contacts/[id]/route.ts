import { handle, body } from "../../_util";
import { getContact, updateContact, deleteContact } from "@/lib/api/services/contacts";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/contacts/[id]
export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => getContact(actor, (await params).id));

// PATCH /api/v1/contacts/[id]
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => updateContact(actor, (await params).id, await body(req)));

// DELETE /api/v1/contacts/[id]
export const DELETE = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => deleteContact(actor, (await params).id));
