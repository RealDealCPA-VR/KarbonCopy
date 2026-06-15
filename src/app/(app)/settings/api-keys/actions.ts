"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { createApiKey, revokeApiKey } from "@/lib/api/auth";

const { activities, users } = schema;

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function audit(actorId: string, verb: string, summary: string) {
  try {
    await db.insert(activities).values({
      actorId,
      verb,
      entityKind: "document",
      entityId: "api-keys",
      summary,
    });
  } catch {
    /* best-effort */
  }
}

function fail(err: unknown): { ok: false; error: string } {
  const msg = (err as Error)?.message ?? "Something went wrong";
  if (msg === "FORBIDDEN") return { ok: false, error: "Admin access required" };
  if (msg === "UNAUTHENTICATED") return { ok: false, error: "Please sign in" };
  return { ok: false, error: msg };
}

/**
 * Mint a new API key. Returns the raw key string ONCE — it is never stored in
 * plaintext and cannot be retrieved again.
 */
export async function createKey(input: {
  name: string;
  userId: string;
}): Promise<ActionResult<{ raw: string; id: string; prefix: string }>> {
  try {
    const admin = await requireAdmin();
    const name = input.name.trim();
    if (!name) return { ok: false, error: "A name is required" };
    if (!input.userId) return { ok: false, error: "Choose a user the key acts as" };

    // Validate the target user is real and active before minting.
    const [target] = await db
      .select({ id: users.id, active: users.active, name: users.name })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!target) return { ok: false, error: "That user no longer exists" };
    if (!target.active) return { ok: false, error: "That user is inactive" };

    const { raw, id, prefix } = await createApiKey({
      name,
      userId: input.userId,
      createdById: admin.id,
    });
    await audit(admin.id, "created", `Minted API key “${name}” acting as ${target.name}`);
    revalidatePath("/settings/api-keys");
    return { ok: true, data: { raw, id, prefix } };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeKey(id: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    if (!id) return { ok: false, error: "Missing key id" };
    await revokeApiKey(id);
    await audit(admin.id, "deleted", `Revoked an API key`);
    revalidatePath("/settings/api-keys");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
