import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Build a plain-text rendering of a thread's messages for the AI helpers.
 * Returns null when the thread has no messages / does not exist.
 */
export async function buildThreadText(threadId: string): Promise<string | null> {
  const [thread] = await db
    .select()
    .from(schema.inboxThreads)
    .where(eq(schema.inboxThreads.id, threadId))
    .limit(1);
  if (!thread) return null;

  const msgs = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.threadId, threadId))
    .orderBy(asc(schema.messages.createdAt));

  const lines = msgs.map((m) => {
    const who =
      m.direction === "note"
        ? `Internal note (${m.fromName ?? "staff"})`
        : m.direction === "outbound"
          ? `Us (${m.fromName ?? "firm"})`
          : `${m.fromName ?? m.fromEmail ?? "Client"}`;
    return `${who}:\n${m.body}`;
  });

  return `Subject: ${thread.subject}\n\n${lines.join("\n\n---\n\n")}`;
}
