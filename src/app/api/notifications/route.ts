import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50);
  return NextResponse.json({ notifications: rows });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, all } = (await req.json().catch(() => ({}))) as { id?: string; all?: boolean };
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
  return NextResponse.json({ ok: true });
}
