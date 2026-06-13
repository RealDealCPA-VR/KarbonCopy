/**
 * Field-level encryption for sensitive PII (EIN / full SSN) at rest.
 * AES-256-GCM with a key derived from APP_ENCRYPTION_KEY (or AUTH_SECRET fallback).
 * Format stored: "enc:v1:<iv b64>:<tag b64>:<ciphertext b64>".
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "enc:v1:";

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
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext — return as-is
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Display mask for an EIN/SSN-like value (operates on decrypted plaintext). */
export function maskTaxId(plain: string | null | undefined): string {
  if (!plain) return "—";
  const digits = plain.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `•••••${digits.slice(-4)}`;
}
