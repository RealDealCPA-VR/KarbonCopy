import { handle, query, body } from "../_util";
import { listTimeEntries, createTimeEntry } from "@/lib/api/services/time";

// GET /api/v1/time — list time entries (filters: userId, workItemId).
export const GET = (req: Request) =>
  handle(req, (actor) => listTimeEntries(actor, query(req, ["userId", "workItemId"])));

// POST /api/v1/time — create a time entry.
export const POST = (req: Request) =>
  handle(req, async (actor) => createTimeEntry(actor, await body(req)), 201);
