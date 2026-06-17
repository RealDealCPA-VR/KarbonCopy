import { NextResponse } from "next/server";
import { destroyPortalSession } from "@/lib/portal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/portal/auth/logout — end the client's portal session.
 *
 * PUBLIC SURFACE (kc_portal realm). The primary logout path is the
 * logoutAction server action used by the portal header; this route exists for
 * programmatic/beacon logout (e.g. on tab close). Idempotent.
 */
export async function POST() {
  try {
    await destroyPortalSession();
  } catch (err) {
    console.error("[portal/logout] failed:", (err as Error).message);
    return NextResponse.json({ error: "Logout failed." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
