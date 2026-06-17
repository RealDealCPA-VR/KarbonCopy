"use server";

/**
 * Client-portal server actions (the `kc_portal` realm).
 *
 * SECURITY: nothing here calls getCurrentUser()/requireUser(). Login & invite
 * acceptance are unauthenticated by nature. The staff-only invite provisioning
 * helper deliberately lives in ./invites.ts as a plain server function (NOT a
 * "use server" action) so it is never exposed as a client-callable endpoint.
 */
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import {
  createPortalSession,
  destroyPortalSession,
  hashPassword,
  verifyPassword,
} from "@/lib/portal-auth";
import { DUMMY_PASSWORD_HASH } from "@/lib/password";
import { checkRateLimit } from "@/app/api/documents/_ratelimit";

const { portalUsers } = schema;

export type AuthState = { error?: string } | undefined;

/** Min password length for client-set passwords. */
const MIN_PASSWORD = 8;

/** Best-effort client IP from proxy headers (no NextRequest in a server action). */
async function actorIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

function normalizeEmail(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim().toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

/**
 * Validate email + password against `portalUsers`, set the kc_portal cookie,
 * and redirect to the dashboard. Rate-limited per IP (and per email) to blunt
 * credential-stuffing. Returns a generic error on any failure (no user
 * enumeration).
 */
export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const ip = await actorIp();
  // 10 attempts / 10 min per IP, plus a per-email guard.
  const byIp = checkRateLimit(`portal-login-ip:${ip}`, 10, 10 * 60_000);
  const byEmail = checkRateLimit(`portal-login-email:${email}`, 10, 10 * 60_000);
  if (!byIp.ok || !byEmail.ok) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  let pu;
  try {
    [pu] = await db
      .select()
      .from(portalUsers)
      .where(eq(portalUsers.email, email))
      .limit(1);
  } catch (err) {
    console.error("[portal] loginAction lookup error:", err);
    return { error: "An error occurred. Please try again." };
  }

  const GENERIC = { error: "Incorrect email or password." } as const;
  // Always run scrypt (against a dummy hash when the account is missing/inactive)
  // so a non-existent email isn't distinguishable by response timing.
  const usable = pu && pu.active && pu.passwordHash;
  const ok = verifyPassword(password, usable ? pu.passwordHash : DUMMY_PASSWORD_HASH);
  if (!usable || !ok) return GENERIC;

  try {
    await createPortalSession(pu.id);
  } catch (err) {
    console.error("[portal] loginAction session error:", err);
    return { error: "Couldn't start your session. Please try again." };
  }
  redirect("/portal/dashboard");
}

/* ------------------------------------------------------------------ */
/* Accept invite / set password                                        */
/* ------------------------------------------------------------------ */

/**
 * Complete an invite: validate the one-time inviteToken, set the password,
 * clear the token, and log the user in. Rate-limited per IP.
 */
export async function acceptInviteAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!token) return { error: "This invite link is invalid." };
  if (password.length < MIN_PASSWORD) {
    return { error: `Choose a password of at least ${MIN_PASSWORD} characters.` };
  }
  if (password !== confirm) return { error: "Passwords do not match." };

  const ip = await actorIp();
  const rl = checkRateLimit(`portal-invite:${ip}`, 15, 10 * 60_000);
  if (!rl.ok) return { error: "Too many attempts. Please wait and try again." };

  // Consume the one-time token atomically: validate and clear it in a single
  // transaction, with the token in the UPDATE's WHERE so two concurrent accepts
  // can't both succeed (TOCTOU → account takeover). The losing request's UPDATE
  // matches zero rows once the token is nulled.
  let portalUserId: string;
  try {
    const result = db.transaction((tx) => {
      const [pu] = tx
        .select()
        .from(portalUsers)
        .where(eq(portalUsers.inviteToken, token))
        .limit(1)
        .all();
      if (!pu || !pu.active) return { ok: false as const, error: "This invite link is invalid." };
      if (pu.inviteExpiresAt && pu.inviteExpiresAt.getTime() < Date.now()) {
        return { ok: false as const, error: "This invite link has expired. Ask your accountant for a new one." };
      }
      const updated = tx
        .update(portalUsers)
        .set({
          passwordHash: hashPassword(password),
          inviteToken: null,
          inviteExpiresAt: null,
        })
        .where(eq(portalUsers.inviteToken, token))
        .returning({ id: portalUsers.id })
        .all();
      if (!updated.length) return { ok: false as const, error: "This invite link is invalid." };
      return { ok: true as const, portalUserId: updated[0].id };
    });
    if (!result.ok) return { error: result.error };
    portalUserId = result.portalUserId;
  } catch (err) {
    console.error("[portal] acceptInviteAction error:", err);
    return { error: "An error occurred. Please try again." };
  }

  try {
    await createPortalSession(portalUserId);
  } catch (err) {
    console.error("[portal] acceptInviteAction session error:", err);
    return { error: "Couldn't start your session. Please try again." };
  }
  redirect("/portal/dashboard");
}

/* ------------------------------------------------------------------ */
/* Logout                                                               */
/* ------------------------------------------------------------------ */

export async function logoutAction(): Promise<void> {
  await destroyPortalSession();
  redirect("/portal/login");
}
