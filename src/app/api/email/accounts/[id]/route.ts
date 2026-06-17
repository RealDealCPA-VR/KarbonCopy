/**
 * Admin API for a single email account.
 *   PATCH  /api/email/accounts/:id  — edit fields / creds / enabled
 *   DELETE /api/email/accounts/:id  — remove the account
 *
 * Auth: requireAdmin. Blank password fields preserve the stored password
 * (mergeSmtpImapConfig) so admins can edit without re-typing secrets.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  deleteAccount,
  getAccount,
  getAccountConfig,
  mergeSmtpImapConfig,
  toSafeAccount,
  updateAccount,
} from "@/lib/email/accounts";
import type { EmailConfig } from "@/lib/email/config";

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

interface PatchBody {
  label?: string;
  address?: string;
  enabled?: boolean;
  smtp?: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string };
  imap?: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string; mailbox?: string };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await ctx.params;

  let account;
  try {
    account = await getAccount(id);
  } catch {
    return NextResponse.json({ error: "Failed to load email account." }, { status: 500 });
  }
  if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Reject blank label/address when provided (POST already does; keep PATCH parity
  // so an update can't null out a required field with an empty string).
  if (body.label !== undefined && !body.label.trim()) {
    return NextResponse.json({ error: "Label cannot be empty." }, { status: 400 });
  }
  if (body.address !== undefined && !body.address.trim()) {
    return NextResponse.json({ error: "Email address cannot be empty." }, { status: 400 });
  }

  // Only rebuild config when SMTP/IMAP fields are present in the payload.
  let config: EmailConfig | undefined;
  if (body.smtp || body.imap) {
    const existing = getAccountConfig(account);
    config = mergeSmtpImapConfig(existing, {
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

  let updated;
  try {
    updated = await updateAccount(id, {
      label: body.label?.trim(),
      address: body.address?.trim(),
      enabled: body.enabled,
      config,
    });
  } catch {
    return NextResponse.json({ error: "Failed to update email account." }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  return NextResponse.json({ account: toSafeAccount(updated) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    await deleteAccount(id);
  } catch {
    return NextResponse.json({ error: "Failed to delete email account." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
