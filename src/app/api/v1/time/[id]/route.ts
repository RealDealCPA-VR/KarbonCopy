import { handle, body } from "../../_util";
import { updateTimeEntry, deleteTimeEntry } from "@/lib/api/services/time";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/v1/time/[id]
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => updateTimeEntry(actor, (await params).id, await body(req)));

// DELETE /api/v1/time/[id]
export const DELETE = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => deleteTimeEntry(actor, (await params).id));
