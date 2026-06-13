import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { reloadWatchers } from "@/server/watcher";

/**
 * POST /api/settings/reload-watchers
 * Hot-reloads the file-server watchers after roots/rules change.
 * Runs in the same Node process, so reloadWatchers() picks up DB changes live.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user, "admin"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await reloadWatchers();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
