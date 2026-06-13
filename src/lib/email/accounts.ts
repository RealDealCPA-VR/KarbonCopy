/**
 * CRUD-ish helpers for `emailAccounts`.
 *
 * Credentials live ONLY inside `configEnc` as `encryptField(JSON.stringify(config))`.
 * - `getAccountConfig()` decrypts for server-side use (poller / sender).
 * - `toSafeAccount()` strips secrets for the client (passwords → boolean flags).
 *
 * These are plain server-side functions (no "use server"); the settings route's
 * server component / route handlers call them after an admin auth check.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { encryptField, decryptField } from "@/lib/crypto";
import type { EmailAccount } from "@/db/schema";
import type {
  EmailConfig,
  EmailProvider,
  SafeEmailAccount,
  SmtpImapConfig,
} from "./config";

const { emailAccounts } = schema;

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function listAccounts(): Promise<EmailAccount[]> {
  return db.select().from(emailAccounts).orderBy(emailAccounts.createdAt);
}

export async function getAccount(id: string): Promise<EmailAccount | null> {
  const [row] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, id)).limit(1);
  return row ?? null;
}

/** Decrypt and parse the stored credential payload. Null if absent/unreadable. */
export function getAccountConfig(account: EmailAccount): EmailConfig | null {
  if (!account.configEnc) return null;
  const json = decryptField(account.configEnc);
  if (!json) return null;
  try {
    return JSON.parse(json) as EmailConfig;
  } catch {
    return null;
  }
}

/** Convenience: fetch + decrypt in one call (for the poller/sender). */
export async function getAccountWithConfig(
  id: string,
): Promise<{ account: EmailAccount; config: EmailConfig | null } | null> {
  const account = await getAccount(id);
  if (!account) return null;
  return { account, config: getAccountConfig(account) };
}

/* ------------------------------------------------------------------ */
/* Safe (credential-free) projection for the client                    */
/* ------------------------------------------------------------------ */

export function toSafeAccount(account: EmailAccount): SafeEmailAccount {
  const config = getAccountConfig(account);
  const safe: SafeEmailAccount = {
    id: account.id,
    label: account.label,
    address: account.address,
    provider: account.provider,
    enabled: account.enabled,
    lastSyncAt: account.lastSyncAt ? account.lastSyncAt.getTime() : null,
    lastError: account.lastError ?? null,
    createdAt: account.createdAt.getTime(),
    configured: !!config,
  };
  if (config && config.kind === "smtp_imap") {
    safe.smtp = {
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      user: config.smtp.user,
      hasPass: !!config.smtp.pass,
    };
    safe.imap = {
      host: config.imap.host,
      port: config.imap.port,
      secure: config.imap.secure,
      user: config.imap.user,
      hasPass: !!config.imap.pass,
      mailbox: config.imap.mailbox || "INBOX",
    };
  }
  return safe;
}

export async function listSafeAccounts(): Promise<SafeEmailAccount[]> {
  const rows = await listAccounts();
  return rows.map(toSafeAccount);
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

export interface CreateAccountInput {
  label: string;
  address: string;
  provider?: EmailProvider;
  enabled?: boolean;
  config?: EmailConfig | null;
}

export async function createAccount(input: CreateAccountInput): Promise<EmailAccount> {
  const [row] = await db
    .insert(emailAccounts)
    .values({
      label: input.label,
      address: input.address,
      provider: input.provider ?? "smtp_imap",
      enabled: input.enabled ?? true,
      configEnc: input.config ? encryptField(JSON.stringify(input.config)) : null,
    })
    .returning();
  return row;
}

export interface UpdateAccountInput {
  label?: string;
  address?: string;
  provider?: EmailProvider;
  enabled?: boolean;
  /** Pass a full config to (re)write `configEnc`. Omit to leave creds untouched. */
  config?: EmailConfig | null;
}

export async function updateAccount(
  id: string,
  input: UpdateAccountInput,
): Promise<EmailAccount | null> {
  const patch: Partial<typeof emailAccounts.$inferInsert> = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.address !== undefined) patch.address = input.address;
  if (input.provider !== undefined) patch.provider = input.provider;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.config !== undefined) {
    patch.configEnc = input.config ? encryptField(JSON.stringify(input.config)) : null;
  }
  if (Object.keys(patch).length === 0) return getAccount(id);
  const [row] = await db
    .update(emailAccounts)
    .set(patch)
    .where(eq(emailAccounts.id, id))
    .returning();
  return row ?? null;
}

export async function deleteAccount(id: string): Promise<void> {
  await db.delete(emailAccounts).where(eq(emailAccounts.id, id));
}

/** Record sync status from the poller (never throws; best-effort). */
export async function setSyncStatus(
  id: string,
  status: { lastSyncAt?: Date; lastError?: string | null },
): Promise<void> {
  try {
    const patch: Partial<typeof emailAccounts.$inferInsert> = {};
    if (status.lastSyncAt !== undefined) patch.lastSyncAt = status.lastSyncAt;
    if (status.lastError !== undefined) patch.lastError = status.lastError;
    await db.update(emailAccounts).set(patch).where(eq(emailAccounts.id, id));
  } catch {
    /* swallow — status bookkeeping must never break the poller */
  }
}

/**
 * Merge a partial SMTP/IMAP form into an existing config so an admin can edit an
 * account without re-typing passwords. Blank password fields keep the prior value.
 */
export function mergeSmtpImapConfig(
  existing: EmailConfig | null,
  next: {
    smtp: { host: string; port: number; secure: boolean; user: string; pass?: string };
    imap: { host: string; port: number; secure: boolean; user: string; pass?: string; mailbox?: string };
  },
): SmtpImapConfig {
  const prev = existing && existing.kind === "smtp_imap" ? existing : null;
  return {
    kind: "smtp_imap",
    smtp: {
      host: next.smtp.host,
      port: next.smtp.port,
      secure: next.smtp.secure,
      user: next.smtp.user,
      pass: next.smtp.pass && next.smtp.pass.length ? next.smtp.pass : (prev?.smtp.pass ?? ""),
    },
    imap: {
      host: next.imap.host,
      port: next.imap.port,
      secure: next.imap.secure,
      user: next.imap.user,
      pass: next.imap.pass && next.imap.pass.length ? next.imap.pass : (prev?.imap.pass ?? ""),
      mailbox: next.imap.mailbox || prev?.imap.mailbox || "INBOX",
    },
  };
}
