import { handle, body } from "../../_util";
import {
  getDeadline,
  updateDeadline,
  setDeadlineStatus,
} from "@/lib/api/services/deadlines";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/deadlines/[id]
export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => getDeadline(actor, (await params).id));

// PATCH /api/v1/deadlines/[id] — `{ status }` sets status; otherwise updates fields.
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => {
    const id = (await params).id;
    const input = (await body(req)) as Record<string, unknown>;
    if (input.status !== undefined) return setDeadlineStatus(actor, id, input.status as string);
    return updateDeadline(actor, id, input);
  });
