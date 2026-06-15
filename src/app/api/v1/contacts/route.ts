import { handle, query, body } from "../_util";
import { listContacts, createContact } from "@/lib/api/services/contacts";

// GET /api/v1/contacts — list contacts (filter: organizationId).
export const GET = (req: Request) =>
  handle(req, (actor) => listContacts(actor, query(req, ["organizationId"])));

// POST /api/v1/contacts — create a contact.
export const POST = (req: Request) =>
  handle(req, async (actor) => createContact(actor, await body(req)), 201);
