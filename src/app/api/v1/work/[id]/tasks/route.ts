import { handle, body } from "../../../_util";
import { listTasks, addTask } from "@/lib/api/services/work";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/work/[id]/tasks — list a work item's tasks.
export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => listTasks(actor, (await params).id));

// POST /api/v1/work/[id]/tasks — add a task.
export const POST = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => addTask(actor, (await params).id, await body(req)), 201);
