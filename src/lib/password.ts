import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const original = Buffer.from(hash, "hex");
  return original.length === candidate.length && timingSafeEqual(original, candidate);
}

/**
 * A valid-format hash of a random secret nobody will ever submit. Verify against
 * this when the account doesn't exist so login stays constant-time and can't be
 * used to enumerate valid emails by timing the scrypt work.
 */
export const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(32).toString("hex"));
