import { handle, param } from "../_util";
import { search } from "@/lib/api/services/search";

// GET /api/v1/search?q=...&limit=... — cross-entity search.
export const GET = (req: Request) =>
  handle(req, (actor) => {
    const q = param(req, "q") ?? "";
    const limit = param(req, "limit");
    return search(actor, q, limit !== null ? { limit: Number(limit) } : {});
  });
