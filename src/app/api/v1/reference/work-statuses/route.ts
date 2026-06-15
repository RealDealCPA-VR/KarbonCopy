import { handle } from "../../_util";
import { listWorkStatuses } from "@/lib/api/services/reference";

// GET /api/v1/reference/work-statuses
export const GET = (req: Request) => handle(req, (actor) => listWorkStatuses(actor));
