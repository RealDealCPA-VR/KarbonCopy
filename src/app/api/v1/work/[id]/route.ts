import { handle, body } from "../../_util";
import {
  getWorkItem,
  updateWorkItem,
  completeWorkItem,
} from "@/lib/api/services/work";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/work/[id]
export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => getWorkItem(actor, (await params).id));

// PATCH /api/v1/work/[id] — update; `{ completed: true }` completes the work item.
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => {
    const id = (await params).id;
    const input = (await body(req)) as Record<string, unknown>;
    if (input.completed === true) return completeWorkItem(actor, id);
    return updateWorkItem(actor, id, input);
  });
