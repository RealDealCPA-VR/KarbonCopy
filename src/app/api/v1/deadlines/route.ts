import { handle, query, body } from "../_util";
import { listDeadlines, createDeadline } from "@/lib/api/services/deadlines";

// GET /api/v1/deadlines — list deadlines.
export const GET = (req: Request) =>
  handle(req, (actor) => listDeadlines(actor, query(req, ["organizationId", "status"])));

// POST /api/v1/deadlines — create a deadline.
export const POST = (req: Request) =>
  handle(req, async (actor) => createDeadline(actor, await body(req)), 201);
