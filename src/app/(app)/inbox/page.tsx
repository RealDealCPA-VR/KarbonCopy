import { asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { aiEnabled } from "@/lib/ai";
import { Triage } from "@/components/inbox/triage";
import type {
  ThreadRow,
  ThreadDetail,
  UserLite,
  OrgLite,
  ContactLite,
  WorkLite,
} from "@/components/inbox/types";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);

  const [threadRows, userRows, orgRows, contactRows, workRows] = await Promise.all([
    db.select().from(schema.inboxThreads).orderBy(desc(schema.inboxThreads.lastMessageAt)),
    db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        image: schema.users.image,
        color: schema.users.color,
      })
      .from(schema.users)
      .where(eq(schema.users.active, true))
      .orderBy(asc(schema.users.name)),
    db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(isNull(schema.organizations.deletedAt))
      .orderBy(asc(schema.organizations.name)),
    db
      .select({
        id: schema.contacts.id,
        firstName: schema.contacts.firstName,
        lastName: schema.contacts.lastName,
        email: schema.contacts.email,
        organizationId: schema.contacts.organizationId,
      })
      .from(schema.contacts)
      .where(isNull(schema.contacts.deletedAt))
      .orderBy(asc(schema.contacts.lastName)),
    db
      .select({
        id: schema.workItems.id,
        title: schema.workItems.title,
        organizationId: schema.workItems.organizationId,
      })
      .from(schema.workItems)
      .where(isNull(schema.workItems.deletedAt))
      .orderBy(desc(schema.workItems.createdAt)),
  ]);

  const users: UserLite[] = userRows;
  const organizations: OrgLite[] = orgRows;
  const contacts: ContactLite[] = contactRows;
  const workItems: WorkLite[] = workRows;

  // Lookup maps for denormalization.
  const userMap = new Map(users.map((u) => [u.id, u]));
  const orgMap = new Map(organizations.map((o) => [o.id, o.name]));
  const contactMap = new Map(contacts.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));
  const workMap = new Map(workItems.map((w) => [w.id, w.title]));

  // All messages for the loaded threads, in one query.
  const threadIds = threadRows.map((t) => t.id);
  const allMessages = threadIds.length
    ? await db
        .select()
        .from(schema.messages)
        .where(inArray(schema.messages.threadId, threadIds))
        .orderBy(asc(schema.messages.createdAt))
    : [];

  const messagesByThread = new Map<string, typeof allMessages>();
  for (const m of allMessages) {
    const arr = messagesByThread.get(m.threadId) ?? [];
    arr.push(m);
    messagesByThread.set(m.threadId, arr);
  }

  const threads: ThreadRow[] = threadRows.map((t) => {
    const msgs = messagesByThread.get(t.id) ?? [];
    const last = msgs[msgs.length - 1];
    return {
      id: t.id,
      subject: t.subject,
      status: t.status,
      assigneeId: t.assigneeId,
      organizationId: t.organizationId,
      contactId: t.contactId,
      workItemId: t.workItemId,
      lastMessageAt: t.lastMessageAt ?? null,
      createdAt: t.createdAt,
      assignee: t.assigneeId ? userMap.get(t.assigneeId) ?? null : null,
      orgName: t.organizationId ? orgMap.get(t.organizationId) ?? null : null,
      contactName: t.contactId ? contactMap.get(t.contactId) ?? null : null,
      workTitle: t.workItemId ? workMap.get(t.workItemId) ?? null : null,
      preview: last ? last.body.replace(/\s+/g, " ").slice(0, 160) : null,
      messageCount: msgs.length,
    };
  });

  const detailsById: Record<string, ThreadDetail> = {};
  for (const t of threads) {
    detailsById[t.id] = { ...t, messages: messagesByThread.get(t.id) ?? [] };
  }

  const initialThreadId = sp.thread && detailsById[sp.thread] ? sp.thread : null;

  return (
    <Triage
      threads={threads}
      detailsById={detailsById}
      users={users}
      organizations={organizations}
      contacts={contacts}
      workItems={workItems}
      currentUserId={user.id}
      aiEnabled={aiEnabled()}
      initialThreadId={initialThreadId}
    />
  );
}
