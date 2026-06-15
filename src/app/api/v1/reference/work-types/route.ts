import { handle } from "../../_util";
import { listWorkTypes } from "@/lib/api/services/reference";

// GET /api/v1/reference/work-types
export const GET = (req: Request) => handle(req, (actor) => listWorkTypes(actor));
