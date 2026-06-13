/**
 * POST /api/email/test — verify SMTP + IMAP connectivity for an account.
 *
 * Body may reference a saved account by `id` (blank passwords fall back to the
 * stored creds) and/or supply ad-hoc smtp/imap fields to test before saving.
 * Auth: requireAdmin. Returns per-protocol { ok, error } — never the creds.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getAccount, getAccountConfig, mergeSmtpImapConfig } from "@/lib/email/accounts";
import { testConnection } from "@/server/email";
import type { SmtpImapConfig } from "@/lib/email/config";

interface TestBody {
  id?: string;
  smtp?: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string };
  imap?: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string; mailbox?: string };
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: TestBody;
  try {
    body = (await req.json()) as TestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Start from the saved config (if testing an existing account) so blank
  // password fields reuse the stored secret.
  let existing = null;
  if (body.id) {
    const account = await getAccount(body.id);
    if (account) existing = getAccountConfig(account);
  }

  const config: SmtpImapConfig = mergeSmtpImapConfig(existing, {
    smtp: {
      host: (body.smtp?.host ?? "").trim(),
      port: Number(body.smtp?.port ?? 587),
      secure: !!body.smtp?.secure,
      user: (body.smtp?.user ?? "").trim(),
      pass: body.smtp?.pass ?? "",
    },
    imap: {
      host: (body.imap?.host ?? "").trim(),
      port: Number(body.imap?.port ?? 993),
      secure: body.imap?.secure ?? true,
      user: (body.imap?.user ?? "").trim(),
      pass: body.imap?.pass ?? "",
      mailbox: (body.imap?.mailbox ?? "INBOX").trim() || "INBOX",
    },
  });

  const result = await testConnection(config);
  return NextResponse.json(result);
}
