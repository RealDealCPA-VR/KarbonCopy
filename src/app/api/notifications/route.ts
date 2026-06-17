import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, user.id))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(50);
    return NextResponse.json({ notifications: rows });
  } catch {
    return NextResponse.json({ error: "Failed to fetch notifications." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let payload: { id?: string; all?: boolean };
  try {
    payload = (await req.json()) as { id?: string; all?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { id, all } = payload;
  if (!all && !id) {
    return NextResponse.json({ error: "Provide `id` or `all`." }, { status: 400 });
  }
  try {
    if (all) {
      await db
        .update(schema.notifications)
        .set({ read: true })
        .where(eq(schema.notifications.userId, user.id));
    } else if (id) {
      await db
        .update(schema.notifications)
        .set({ read: true })
        .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, user.id)));
    }
  } catch {
    return NextResponse.json({ error: "Failed to update notifications." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
