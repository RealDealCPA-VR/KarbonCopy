import { handle } from "../../../_util";
import { completeWorkItem } from "@/lib/api/services/work";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/v1/work/[id]/complete — mark a work item complete.
export const POST = (req: Request, { params }: Ctx) =>
  handle(req, async (actor) => completeWorkItem(actor, (await params).id));
