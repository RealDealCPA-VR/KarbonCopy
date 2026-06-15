import { handle, query, body } from "../_util";
import { listOrganizations, createOrganization } from "@/lib/api/services/organizations";

// GET /api/v1/clients — list organizations (clients).
export const GET = (req: Request) =>
  handle(req, (actor) => listOrganizations(actor, query(req)));

// POST /api/v1/clients — create an organization.
export const POST = (req: Request) =>
  handle(req, async (actor) => createOrganization(actor, await body(req)), 201);
