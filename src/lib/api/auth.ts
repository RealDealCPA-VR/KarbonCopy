/**
 * API-key auth — usable by REST routes (Next) AND the standalone MCP process.
 * No server-only / next/headers. A key acts AS its owning user (inherits role).
 *
 * Key format: kc_live_<32 url-safe chars>. We store only sha256(rawKey).
 */
import { createHash, randomBytes } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import type { User } from "@/db/schema";
import { ApiError } from "./errors";

const { apiKeys, users } = schema;
const KEY_PREFIX = "kc_live_";

export function generateRawKey(): string {
  return KEY_PREFIX + randomBytes(24).toString("base64url");
}

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Display prefix stored for UI (e.g. "kc_live_ab12cd"). */
export function keyPrefix(raw: string): string {
  return raw.slice(0, KEY_PREFIX.length + 6);
}

export type ApiActor = User & { apiKeyId: string; scopes: string[] | null };

/**
 * Resolve a raw API key string to the acting user. Returns null if missing,
 * malformed, revoked, expired, or the user is inactive. Updates lastUsedAt.
 */
export async function resolveActorFromKey(raw: string | undefined | null): Promise<ApiActor | null> {
  if (!raw || !raw.startsWith(KEY_PREFIX)) return null;
  const hash = hashKey(raw.trim());
  const rows = await db
    .select()
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.revoked, false)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const key = row.api_keys;
  const user = row.users;
  if (!user.active) return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
  // best-effort last-used stamp (sync better-sqlite3)
  try {
    db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id)).run();
  } catch {
    /* non-fatal */
  }
  return { ...user, apiKeyId: key.id, scopes: key.scopes ?? null };
}

/** Extract a bearer/x-api-key value from request headers. */
export function readApiKeyHeader(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return headers.get("x-api-key");
}

/** Resolve the actor for a Request or throw 401. */
export async function requireActor(req: Request): Promise<ApiActor> {
  const actor = await resolveActorFromKey(readApiKeyHeader(req.headers));
  if (!actor) throw new ApiError("unauthorized", "Invalid or missing API key");
  return actor;
}

/* ---- key management (used by Settings UI) ----------------------- */

export async function createApiKey(opts: {
  name: string;
  userId: string;
  createdById?: string | null;
  scopes?: string[] | null;
  expiresAt?: Date | null;
}): Promise<{ raw: string; id: string; prefix: string }> {
  const raw = generateRawKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      name: opts.name,
      userId: opts.userId,
      createdById: opts.createdById ?? opts.userId,
      keyHash: hashKey(raw),
      prefix: keyPrefix(raw),
      scopes: opts.scopes ?? null,
      expiresAt: opts.expiresAt ?? null,
    })
    .returning();
  if (!row) throw new Error("API key could not be created.");
  return { raw, id: row.id, prefix: row.prefix };
}

export async function revokeApiKey(id: string): Promise<void> {
  await db.update(apiKeys).set({ revoked: true }).where(eq(apiKeys.id, id));
}

export async function listApiKeys() {
  return db.select().from(apiKeys).orderBy(apiKeys.createdAt);
}
