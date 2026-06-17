/**
 * POST /api/email/send — send a real email through a configured account and
 * persist the outbound message into the Triage thread.
 *
 * Body: { accountId, to, subject, body, threadId? }
 * Auth: requireWrite (blocks read-only users).
 */
import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/auth";
import { sendEmail } from "@/server/email";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireWrite();
  } catch (e) {
    const unauth = e instanceof Error && e.message === "UNAUTHENTICATED";
    return NextResponse.json(
      { error: unauth ? "Unauthorized" : "Forbidden" },
      { status: unauth ? 401 : 403 },
    );
  }

  let body: {
    accountId?: string;
    to?: string;
    subject?: string;
    body?: string;
    threadId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const accountId = body.accountId?.trim();
  const to = body.to?.trim();
  const subject = (body.subject ?? "").trim();
  const text = (body.body ?? "").toString();

  if (!accountId) return NextResponse.json({ error: "Missing accountId." }, { status: 400 });
  if (!to) return NextResponse.json({ error: "Recipient (to) is required." }, { status: 400 });
  if (!text.trim()) return NextResponse.json({ error: "Message body is empty." }, { status: 400 });

  try {
    const result = await sendEmail({
      accountId,
      to,
      subject,
      body: text,
      threadId: body.threadId?.trim() || undefined,
      sentById: user.id,
      fromName: user.name,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Failed to send email." },
      { status: 502 },
    );
  }
}
