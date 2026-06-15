import { handle, body } from "../../../../_util";
import { toggleTask } from "@/lib/api/services/work";

type Ctx = { params: Promise<{ id: string; taskId: string }> };

// PATCH /api/v1/work/[id]/tasks/[taskId] — toggle done state via { completed }.
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => {
    const { taskId } = await params;
    const input = (await body(req)) as { completed?: boolean };
    return toggleTask(actor, taskId, input.completed === true);
  });
