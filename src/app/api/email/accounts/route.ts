/**
 * Admin API for managing email accounts.
 *   GET  /api/email/accounts        — list (credential-free)
 *   POST /api/email/accounts        — create an smtp_imap account
 *
 * Auth: requireAdmin. Credentials are stored encrypted via lib/email/accounts;
 * raw passwords are never returned to the client.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  createAccount,
  listSafeAccounts,
  toSafeAccount,
  mergeSmtpImapConfig,
} from "@/lib/email/accounts";
import type { SmtpImapConfig } from "@/lib/email/config";

async function guard() {
  try {
    await requireAdmin();
    return null;
  } catch (e) {
    const unauth = e instanceof Error && e.message === "UNAUTHENTICATED";
    return NextResponse.json(
      { error: unauth ? "Unauthorized" : "Forbidden" },
      { status: unauth ? 401 : 403 },
    );
  }
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  try {
    return NextResponse.json({ accounts: await listSafeAccounts() });
  } catch {
    return NextResponse.json({ error: "Failed to fetch email accounts." }, { status: 500 });
  }
}

interface AccountBody {
  label?: string;
  address?: string;
  enabled?: boolean;
  smtp?: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string };
  imap?: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string; mailbox?: string };
}

function buildConfig(body: AccountBody): SmtpImapConfig {
  return mergeSmtpImapConfig(null, {
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
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: AccountBody;
  try {
    body = (await req.json()) as AccountBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const label = body.label?.trim();
  const address = body.address?.trim();
  if (!label) return NextResponse.json({ error: "Label is required." }, { status: 400 });
  if (!address) return NextResponse.json({ error: "Email address is required." }, { status: 400 });

  const config = buildConfig(body);
  try {
    const account = await createAccount({
      label,
      address,
      provider: "smtp_imap",
      enabled: body.enabled ?? true,
      config,
    });
    return NextResponse.json({ account: toSafeAccount(account) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create email account." }, { status: 500 });
  }
}
