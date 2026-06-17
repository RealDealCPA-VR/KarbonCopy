/**
 * Field-level encryption for sensitive PII (EIN / full SSN) at rest.
 * AES-256-GCM with a key derived from APP_ENCRYPTION_KEY (or AUTH_SECRET fallback).
 * Format stored: "enc:v1:<iv b64>:<tag b64>:<ciphertext b64>".
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "enc:v1:";
let warnedPlaintext = false;
let warnedDecryptFail = false;

function key(): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY || process.env.AUTH_SECRET || "";
  if (!secret) throw new Error("APP_ENCRYPTION_KEY/AUTH_SECRET required for PII encryption");
  // Deterministic 32-byte key from the secret.
  return scryptSync(secret, "karboncopy-pii-v1", 32);
}

export function encryptField(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptField(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return stored ?? null;
  if (!stored.startsWith(PREFIX)) {
    // Legacy/plaintext value (no enc: prefix). All current writes encrypt, so a
    // plaintext read is unexpected — surface it once instead of failing silently.
    if (!warnedPlaintext) {
      warnedPlaintext = true;
      console.warn("[crypto] read an unencrypted value (no enc:v1: prefix) — a field may have been stored in plaintext.");
    }
    return stored;
  }
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // An enc:v1: value that won't decrypt = wrong APP_ENCRYPTION_KEY or corruption.
    // Never silently treat this as "no value" — make the key-rotation mistake loud.
    if (!warnedDecryptFail) {
      warnedDecryptFail = true;
      console.error("[crypto] failed to decrypt an enc:v1: value — APP_ENCRYPTION_KEY may have changed or the data is corrupt. Stored secrets/PII are unreadable until the original key is restored.");
    }
    return null;
  }
}

/**
 * True if `stored` is an enc:v1: value that DECRYPTS with the current key.
 * Used by startup validation to detect a changed APP_ENCRYPTION_KEY before any
 * service silently treats unreadable secrets as "not configured".
 */
export function canDecrypt(stored: string | null | undefined): boolean {
  if (stored == null || stored === "" || !stored.startsWith(PREFIX)) return true;
  return decryptField(stored) !== null;
}

/** Display mask for an EIN/SSN-like value (operates on decrypted plaintext). */
export function maskTaxId(plain: string | null | undefined): string {
  if (!plain) return "—";
  const digits = plain.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `•••••${digits.slice(-4)}`;
}
