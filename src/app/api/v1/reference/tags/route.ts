import { handle } from "../../_util";
import { listTags } from "@/lib/api/services/reference";

// GET /api/v1/reference/tags
export const GET = (req: Request) => handle(req, (actor) => listTags(actor));
