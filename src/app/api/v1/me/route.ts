import { handle } from "../_util";

// GET /api/v1/me — the actor behind the API key.
export const GET = (req: Request) =>
  handle(req, async (actor) => ({
    id: actor.id,
    name: actor.name,
    email: actor.email,
    role: actor.role,
  }));
