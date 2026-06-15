/**
 * Shared service-layer helpers. Services are PURE (no Next, no server-only):
 * they take an explicit actor, enforce RBAC, validate with zod, write via
 * drizzle, log activity, and return plain objects. Used by /api/v1 REST routes
 * AND the standalone MCP server, which share one connection-per-process db.
 */
import { z } from "zod";
import { db, schema } from "@/db";
import type { User, EntityKind } from "@/db/schema";
import { hasRole } from "@/lib/rbac";
import type { UserRole } from "@/db/schema";
import { ApiError, validation } from "@/lib/api/errors";

export { db, schema };
export type Actor = User;

/** Throw 403 unless the actor meets the minimum role. */
export function requireRole(actor: Actor, min: UserRole): void {
  if (!hasRole(actor, min)) {
    throw new ApiError("forbidden", `Requires ${min} role or higher`);
  }
}
export const requireWrite = (a: Actor) => requireRole(a, "staff");
export const requireManager = (a: Actor) => requireRole(a, "manager");

/** Validate input against a zod schema, throwing a 422 ApiError on failure. */
export function parse<T extends z.ZodTypeAny>(schemaZ: T, input: unknown): z.infer<T> {
  const r = schemaZ.safeParse(input);
  if (!r.success) {
    throw validation("Invalid input", r.error.flatten());
  }
  return r.data;
}

/** Write an activity row (best-effort; no Next revalidation). */
export async function logActivity(opts: {
  actorId: string;
  verb: string;
  entityKind: EntityKind;
  entityId: string;
  summary: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(schema.activities).values({
      actorId: opts.actorId,
      verb: opts.verb,
      entityKind: opts.entityKind,
      entityId: opts.entityId,
      summary: opts.summary,
      meta: opts.meta,
    });
  } catch {
    /* non-fatal */
  }
}

/** Standard pagination input. */
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().optional(),
});
export type Pagination = z.infer<typeof pagination>;
