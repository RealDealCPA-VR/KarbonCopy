import type { Message, ThreadStatus } from "@/db/schema";

export type UserLite = { id: string; name: string; image: string | null; color: string | null };

export type OrgLite = { id: string; name: string };

export type ContactLite = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  organizationId: string | null;
};

export type WorkLite = { id: string; title: string; organizationId: string | null };

export type ThreadRow = {
  id: string;
  subject: string;
  status: ThreadStatus;
  assigneeId: string | null;
  organizationId: string | null;
  contactId: string | null;
  workItemId: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  // denormalized
  assignee: UserLite | null;
  orgName: string | null;
  contactName: string | null;
  workTitle: string | null;
  preview: string | null;
  messageCount: number;
};

export type ThreadDetail = ThreadRow & {
  messages: Message[];
};

export type FilterTab = "all" | "mine" | "unassigned" | "waiting" | "closed";

export const STATUS_META: Record<
  ThreadStatus,
  { label: string; badge: "default" | "secondary" | "success" | "warning" | "destructive" | "outline" }
> = {
  open: { label: "Open", badge: "secondary" },
  assigned: { label: "Assigned", badge: "default" },
  waiting: { label: "Waiting", badge: "warning" },
  closed: { label: "Closed", badge: "outline" },
};

export const STATUS_ORDER: ThreadStatus[] = ["open", "assigned", "waiting", "closed"];
