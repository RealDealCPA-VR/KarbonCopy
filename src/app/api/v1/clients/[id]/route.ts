import { handle, body } from "../../_util";
import {
  getOrganization,
  updateOrganization,
  archiveOrganization,
} from "@/lib/api/services/organizations";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/clients/[id]
export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => getOrganization(actor, (await params).id));

// PATCH /api/v1/clients/[id]
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => updateOrganization(actor, (await params).id, await body(req)));

// DELETE /api/v1/clients/[id] — archive.
export const DELETE = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => archiveOrganization(actor, (await params).id));
