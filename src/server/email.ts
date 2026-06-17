/**
 * Real two-way email for the Triage inbox.
 *
 *  RECEIVE: a poller connects to each enabled account's IMAP mailbox every ~60s,
 *  fetches messages newer than the last seen UID, and ingests each into
 *  inboxThreads/messages — correlating to an existing thread by RFC822 headers
 *  (In-Reply-To / References / Message-ID / subject) and linking the sender's
 *  email to a contact → organization. Inbound rows carry `externalId` (the
 *  Message-ID) + `accountId`. New mail bumps the thread, broadcasts, and notifies
 *  the assignee.
 *
 *  SEND: `sendEmail()` delivers via the account's SMTP transport (nodemailer) and
 *  persists an outbound messages row in the same thread.
 *
 * Resilience: every account is polled inside its own try/catch; failures are
 * stored on `emailAccounts.lastError` and never propagate out of the poller. The
 * coordinator calls `startEmailPoller()` from server.ts.
 */
import "server-only";
import nodemailer from "nodemailer";
import { ImapFlow, type FetchMessageObject, type MessageAddressObject } from "imapflow";
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { broadcast, emitToUser } from "./realtime";
import {
  getAccountConfig,
  getAccountWithConfig,
  listAccounts,
  setSyncStatus,
} from "@/lib/email/accounts";
import { isSmtpImap, type EmailConfig, type SmtpImapConfig } from "@/lib/email/config";
import type { EmailAccount } from "@/db/schema";

const { emailAccounts, inboxThreads, messages, contacts, notifications } = schema;

const POLL_INTERVAL_MS = 60_000;
/** Don't reach back further than this on first sync (avoid hauling years of mail). */
const FIRST_SYNC_LOOKBACK_DAYS = 7;

// Persist poller state on globalThis so HMR / route reloads don't spin up
// duplicate timers acting on the same DB.
const g = globalThis as unknown as {
  __kcEmailTimer?: ReturnType<typeof setInterval>;
  __kcEmailRunning?: boolean;
  __kcEmailLastUid?: Map<string, number>; // accountId -> last ingested UID
};
const lastUidByAccount: Map<string, number> = (g.__kcEmailLastUid ??= new Map());

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function firstAddress(list?: MessageAddressObject[]): { name: string | null; email: string | null } {
  const a = list?.[0];
  return { name: a?.name?.trim() || null, email: a?.address?.trim()?.toLowerCase() || null };
}

/** Normalize a subject for thread-matching: strip Re:/Fwd: prefixes + trim. */
function normalizeSubject(subject: string | undefined | null): string {
  return (subject ?? "")
    .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

/** Extract candidate Message-IDs from References/In-Reply-To header strings. */
function parseMessageIds(value?: string | null): string[] {
  if (!value) return [];
  return (value.match(/<[^>]+>/g) ?? []).map((s) => s.trim());
}

/**
 * Pull the best-effort plaintext body out of a fetched message. We download the
 * full source and take everything after the first blank line (the headers/body
 * separator). Good enough for triage display without a heavyweight MIME parser.
 */
function extractBody(source: Buffer | undefined): string {
  if (!source) return "";
  const text = source.toString("utf8");
  const sep = text.indexOf("\r\n\r\n");
  const altSep = sep === -1 ? text.indexOf("\n\n") : sep;
  const body = altSep === -1 ? text : text.slice(altSep).trim();
  // Cap to keep DB rows sane; triage shows a preview, full mail stays on the server.
  return body.length > 20000 ? body.slice(0, 20000) + "\n\n[…truncated]" : body;
}

/* ================================================================== */
/* Correlation: find/create the thread for an inbound message          */
/* ================================================================== */

async function resolveContactOrg(fromEmail: string | null): Promise<{
  contactId: string | null;
  organizationId: string | null;
}> {
  if (!fromEmail) return { contactId: null, organizationId: null };
  const [contact] = await db
    .select({ id: contacts.id, organizationId: contacts.organizationId })
    .from(contacts)
    .where(eq(contacts.email, fromEmail))
    .limit(1);
  return {
    contactId: contact?.id ?? null,
    organizationId: contact?.organizationId ?? null,
  };
}

/** Find an existing thread this message belongs to, else null. */
async function findThreadForMessage(opts: {
  references: string[];
  subject: string | null;
  fromEmail: string | null;
}): Promise<string | null> {
  // 1) Correlate by referenced Message-IDs (most reliable).
  if (opts.references.length) {
    const refRows = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(and(isNotNull(messages.externalId), inArrayLike(messages.externalId, opts.references)))
      .limit(1);
    if (refRows[0]?.threadId) return refRows[0].threadId;
  }

  // 2) Fall back to a normalized-subject match against a recent open-ish thread
  //    from/to the same contact.
  const norm = normalizeSubject(opts.subject);
  if (norm) {
    const candidates = await db
      .select({ id: inboxThreads.id, subject: inboxThreads.subject })
      .from(inboxThreads)
      .orderBy(desc(inboxThreads.lastMessageAt))
      .limit(50);
    const hit = candidates.find((c) => normalizeSubject(c.subject) === norm);
    if (hit) return hit.id;
  }
  return null;
}

/**
 * Drizzle has no native "column IN (list)" for our string list with `like`, so
 * build an OR of equality checks. (Message-IDs are exact strings.)
 */
function inArrayLike(col: typeof messages.externalId, values: string[]) {
  const clauses = values.map((v) => eq(col, v));
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

/* ================================================================== */
/* Ingest one fetched message                                          */
/* ================================================================== */

async function ingestMessage(account: EmailAccount, msg: FetchMessageObject): Promise<boolean> {
  const env = msg.envelope;
  const messageId = env?.messageId?.trim() || null;

  // De-dupe: skip if we've already stored this externalId.
  if (messageId) {
    const [existing] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.externalId, messageId))
      .limit(1);
    if (existing) return false;
  }

  const from = firstAddress(env?.from);
  const to = firstAddress(env?.to);
  const subject = env?.subject?.trim() || "(no subject)";
  const body = extractBody(msg.source);
  const receivedAt = env?.date ?? new Date();

  const references = [
    ...parseMessageIds(env?.inReplyTo),
    // imapflow's envelope doesn't expose References; In-Reply-To covers replies.
  ];

  const { contactId, organizationId } = await resolveContactOrg(from.email);

  let threadId = await findThreadForMessage({
    references,
    subject,
    fromEmail: from.email,
  });

  if (!threadId) {
    const [thread] = await db
      .insert(inboxThreads)
      .values({
        subject,
        status: "open",
        organizationId,
        contactId,
        lastMessageAt: receivedAt,
      })
      .returning({ id: inboxThreads.id });
    if (!thread) throw new Error("Inbox thread could not be created.");
    threadId = thread.id;
  } else {
    // Backfill links + bump activity timestamp on the existing thread.
    await db
      .update(inboxThreads)
      .set({ lastMessageAt: receivedAt })
      .where(eq(inboxThreads.id, threadId));
  }

  const [msgRow] = await db
    .insert(messages)
    .values({
      threadId,
      fromName: from.name,
      fromEmail: from.email,
      toEmail: to.email ?? account.address,
      body: body || "(empty message)",
      direction: "inbound",
      externalId: messageId,
      accountId: account.id,
      createdAt: receivedAt,
    })
    .returning({ id: messages.id });
  // Only claim success once the row is actually persisted — otherwise the poller
  // advances its UID cursor past this message and it's lost forever.
  if (!msgRow) throw new Error("Inbound message could not be created.");

  // Notify the assignee (if any) + broadcast for live inbox refresh.
  const [thread] = await db
    .select({ assigneeId: inboxThreads.assigneeId, subject: inboxThreads.subject })
    .from(inboxThreads)
    .where(eq(inboxThreads.id, threadId))
    .limit(1);

  if (thread?.assigneeId) {
    const [notif] = await db
      .insert(notifications)
      .values({
        userId: thread.assigneeId,
        type: "system",
        title: "New email reply",
        body: `${from.name || from.email || "Someone"}: ${subject}`,
        entityKind: "thread",
        entityId: threadId,
      })
      .returning();
    if (notif) emitToUser(thread.assigneeId, "notification", notif);
  }

  broadcast("inbox_message", {
    threadId,
    direction: "inbound",
    subject,
    fromName: from.name,
    fromEmail: from.email,
  });

  return true;
}

/* ================================================================== */
/* Poll a single account                                               */
/* ================================================================== */

async function pollAccount(account: EmailAccount): Promise<void> {
  const config = getAccountConfig(account);
  if (!isSmtpImap(config)) {
    // gmail/graph not implemented yet — mark idle, don't error noisily.
    await setSyncStatus(account.id, {
      lastError: config ? "Provider not yet supported (only smtp_imap)." : "Not configured.",
    });
    return;
  }

  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.imap.user, pass: config.imap.pass },
    logger: false,
    // Keep the poller snappy and resilient on a flaky LAN.
    socketTimeout: 30_000,
  });

  const mailbox = config.imap.mailbox || "INBOX";
  let count = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailbox);
    try {
      const lastUid = lastUidByAccount.get(account.id) ?? 0;

      let range: string | null = null;
      if (lastUid > 0) {
        range = `${lastUid + 1}:*`;
      } else {
        // First run for this process: pull a short recent window by date.
        const since = new Date(Date.now() - FIRST_SYNC_LOOKBACK_DAYS * 86400_000);
        const uids = await client.search({ since }, { uid: true });
        if (!uids || uids.length === 0) {
          await setSyncStatus(account.id, { lastSyncAt: new Date(), lastError: null });
          return;
        }
        range = `${Math.min(...uids)}:*`;
      }

      let maxUid = lastUid;
      for await (const msg of client.fetch(
        range,
        { uid: true, envelope: true, source: true },
        { uid: true },
      )) {
        if (msg.uid <= lastUid) continue;
        try {
          const ingested = await ingestMessage(account, msg);
          if (ingested) count++;
        } catch (err) {
          console.error(`[email] ingest failed (account ${account.id}, uid ${msg.uid}):`, err);
          // Do NOT advance the UID cursor past a message we failed to persist —
          // and stop here so we don't skip it by advancing past a later UID. It
          // will be retried from this UID on the next poll.
          break;
        }
        // Only advance the cursor once the message is actually persisted.
        if (msg.uid > maxUid) maxUid = msg.uid;
      }
      lastUidByAccount.set(account.id, maxUid);
    } finally {
      lock.release();
    }
    await setSyncStatus(account.id, { lastSyncAt: new Date(), lastError: null });
    if (count > 0) console.log(`[email] ${account.label}: ingested ${count} message(s)`);
  } catch (err) {
    const message = (err as Error).message || String(err);
    console.warn(`[email] poll failed for ${account.label}:`, message);
    await setSyncStatus(account.id, { lastError: message });
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore logout errors */
    }
  }
}

/* ================================================================== */
/* Poller lifecycle                                                    */
/* ================================================================== */

async function pollAllOnce(): Promise<void> {
  if (g.__kcEmailRunning) return; // never overlap runs
  g.__kcEmailRunning = true;
  try {
    let accounts: EmailAccount[];
    try {
      accounts = (await listAccounts()).filter((a) => a.enabled);
    } catch (err) {
      console.warn("[email] could not load accounts (db not ready?):", (err as Error).message);
      return;
    }
    if (accounts.length === 0) return; // graceful idle — no accounts configured
    for (const account of accounts) {
      // Each account isolated: one bad mailbox never blocks the others.
      await pollAccount(account).catch((e) =>
        console.error(`[email] unexpected poll error for ${account.id}:`, e),
      );
    }
  } finally {
    g.__kcEmailRunning = false;
  }
}

/** Start the periodic IMAP poller. Idempotent + safe to call when no accounts exist. */
export function startEmailPoller(): void {
  if (g.__kcEmailTimer) return; // already running
  // Kick an initial run shortly after boot, then on an interval.
  setTimeout(() => {
    pollAllOnce().catch((e) => console.error("[email] initial poll failed:", e));
  }, 3_000).unref?.();

  g.__kcEmailTimer = setInterval(() => {
    pollAllOnce().catch((e) => console.error("[email] poll cycle failed:", e));
  }, POLL_INTERVAL_MS);
  g.__kcEmailTimer.unref?.();
  console.log("[email] poller started (every 60s)");
}

export function stopEmailPoller(): void {
  if (g.__kcEmailTimer) {
    clearInterval(g.__kcEmailTimer);
    g.__kcEmailTimer = undefined;
  }
}

/** Force an immediate poll cycle (e.g. after an account is added in Settings). */
export async function pollNow(): Promise<void> {
  await pollAllOnce();
}

/* ================================================================== */
/* Send                                                                */
/* ================================================================== */

function smtpTransport(config: SmtpImapConfig) {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
    // Bound the connect/socket so an unresponsive SMTP server can't hang the
    // single shared process (mirrors the IMAP client's 30s socketTimeout).
    connectionTimeout: 30_000,
    socketTimeout: 30_000,
    greetingTimeout: 30_000,
  });
}

export interface SendEmailInput {
  accountId: string;
  to: string;
  subject: string;
  body: string;
  /** Existing inbox thread to append the outbound message to. */
  threadId?: string;
  /** Optional staff user id to attribute the outbound message to. */
  sentById?: string | null;
  /** Optional display name for the From field. */
  fromName?: string | null;
}

export interface SendEmailResult {
  messageId: string | null;
  threadId: string;
  dbMessageId: string;
}

/**
 * Send a mail over the account's SMTP transport and persist an outbound
 * messages row. If `threadId` is omitted, a new thread is created so the sent
 * mail is visible in Triage.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const loaded = await getAccountWithConfig(input.accountId);
  if (!loaded) throw new Error("Email account not found.");
  const { account, config } = loaded;
  if (!isSmtpImap(config)) {
    throw new Error("This account does not have SMTP/IMAP configured.");
  }
  if (!account.enabled) throw new Error("Email account is disabled.");

  const to = input.to.trim();
  const subject = input.subject.trim() || "(no subject)";
  if (!to) throw new Error("Recipient is required.");

  const fromAddress = account.address;
  const from = input.fromName ? `${input.fromName} <${fromAddress}>` : fromAddress;

  const transport = smtpTransport(config);
  let info;
  try {
    info = await transport.sendMail({
      from,
      to,
      subject,
      text: input.body,
    });
  } catch (err) {
    // Surface a clean, operator-actionable message (their own SMTP server's
    // response) without leaking an error object/stack; log the full detail.
    console.error("[email] sendMail failed:", err);
    const detail = err instanceof Error ? err.message : "unknown SMTP error";
    throw new Error(`Email could not be sent: ${detail}`);
  }
  const messageId = (info.messageId as string | undefined) ?? null;

  // Resolve/create the thread for the sent mail.
  let threadId = input.threadId ?? null;
  const now = new Date();
  if (threadId) {
    const [t] = await db
      .select({ id: inboxThreads.id })
      .from(inboxThreads)
      .where(eq(inboxThreads.id, threadId))
      .limit(1);
    if (!t) threadId = null;
  }
  if (!threadId) {
    const { contactId, organizationId } = await resolveContactOrg(to.toLowerCase());
    const [thread] = await db
      .insert(inboxThreads)
      .values({
        subject,
        status: "open",
        organizationId,
        contactId,
        lastMessageAt: now,
      })
      .returning({ id: inboxThreads.id });
    if (!thread) throw new Error("Inbox thread could not be created.");
    threadId = thread.id;
  }

  const [row] = await db
    .insert(messages)
    .values({
      threadId,
      fromName: input.fromName ?? account.label,
      fromEmail: fromAddress,
      toEmail: to,
      body: input.body,
      direction: "outbound",
      externalId: messageId,
      accountId: account.id,
      sentById: input.sentById ?? null,
    })
    .returning({ id: messages.id });
  if (!row) throw new Error("Outbound message could not be created.");

  await db.update(inboxThreads).set({ lastMessageAt: now }).where(eq(inboxThreads.id, threadId));

  broadcast("inbox_message", { threadId, direction: "outbound", subject });

  return { messageId, threadId, dbMessageId: row.id };
}

/* ================================================================== */
/* Connection test (used by Settings "Test connection")               */
/* ================================================================== */

export interface TestConnectionResult {
  smtp: { ok: boolean; error?: string };
  imap: { ok: boolean; error?: string };
}

/** Verify SMTP (transport.verify) and IMAP (connect + open mailbox). */
export async function testConnection(config: EmailConfig | null): Promise<TestConnectionResult> {
  const result: TestConnectionResult = { smtp: { ok: false }, imap: { ok: false } };
  if (!isSmtpImap(config)) {
    const msg = "Only SMTP/IMAP accounts can be tested.";
    return { smtp: { ok: false, error: msg }, imap: { ok: false, error: msg } };
  }

  // SMTP
  try {
    const transport = smtpTransport(config);
    await transport.verify();
    result.smtp.ok = true;
  } catch (err) {
    result.smtp.error = (err as Error).message || String(err);
  }

  // IMAP
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.imap.user, pass: config.imap.pass },
    logger: false,
    socketTimeout: 20_000,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.imap.mailbox || "INBOX");
    lock.release();
    result.imap.ok = true;
  } catch (err) {
    result.imap.error = (err as Error).message || String(err);
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }

  return result;
}
