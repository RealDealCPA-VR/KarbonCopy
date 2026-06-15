import { handle, query, body } from "../_util";
import { listWorkItems, createWorkItem } from "@/lib/api/services/work";

// GET /api/v1/work — list work items (filters: organizationId, assigneeId, statusId).
export const GET = (req: Request) =>
  handle(req, (actor) =>
    listWorkItems(actor, query(req, ["organizationId", "assigneeId", "statusId"])),
  );

// POST /api/v1/work — create a work item.
export const POST = (req: Request) =>
  handle(req, async (actor) => createWorkItem(actor, await body(req)), 201);
