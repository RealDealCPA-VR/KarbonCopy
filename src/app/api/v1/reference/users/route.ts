import { handle } from "../../_util";
import { listUsers } from "@/lib/api/services/reference";

// GET /api/v1/reference/users
export const GET = (req: Request) => handle(req, (actor) => listUsers(actor));
