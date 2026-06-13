"use client";

import * as React from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ChevronLeft, StickyNote, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { STATUS_META, type ThreadDetail } from "./types";
import { ThreadActions } from "./thread-actions";
import type { UserLite, OrgLite, ContactLite, WorkLite } from "./types";

export function Conversation({
  thread,
  users,
  organizations,
  contacts,
  workItems,
  currentUserId,
  aiEnabled,
  onBack,
}: {
  thread: ThreadDetail;
  users: UserLite[];
  organizations: OrgLite[];
  contacts: ContactLite[];
  workItems: WorkLite[];
  currentUserId: string;
  aiEnabled: boolean;
  onBack: () => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Jump to newest message on thread change / new message.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.id, thread.messages.length]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start gap-3 border-b p-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 lg:hidden"
          onClick={onBack}
          aria-label="Back to list"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-bold tracking-tight">{thread.subject}</h2>
            <Badge variant={STATUS_META[thread.status].badge}>
              {STATUS_META[thread.status].label}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"}
            {thread.lastMessageAt
              ? ` · last activity ${formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: true })}`
              : ""}
          </p>
        </div>
        <ThreadActions
          thread={thread}
          users={users}
          organizations={organizations}
          contacts={contacts}
          workItems={workItems}
        />
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {thread.messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          thread.messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      {/* Composer */}
      <Composer
        threadId={thread.id}
        hasLinkedWork={Boolean(thread.workItemId)}
        aiEnabled={aiEnabled}
      />
    </div>
  );
}

function MessageBubble({
  message: m,
}: {
  message: ThreadDetail["messages"][number];
}) {
  if (m.direction === "note") {
    return (
      <div className="mx-auto max-w-[92%] rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-warning">
          <StickyNote className="h-3.5 w-3.5" /> Internal note
          <span className="text-muted-foreground">· {m.fromName ?? "staff"}</span>
          <span className="ml-auto text-muted-foreground">{format(new Date(m.createdAt), "MMM d, p")}</span>
        </div>
        <p className="whitespace-pre-wrap text-foreground/90">{m.body}</p>
      </div>
    );
  }

  const outbound = m.direction === "outbound";
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-1", outbound && "items-end")}>
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs text-muted-foreground",
            outbound && "justify-end",
          )}
        >
          <Mail className="h-3 w-3" />
          <span className="font-medium text-foreground/80">
            {outbound ? m.fromName ?? "Us" : m.fromName ?? m.fromEmail ?? "Client"}
          </span>
          <span>· {format(new Date(m.createdAt), "MMM d, p")}</span>
        </div>
        <div
          className={cn(
            "rounded-xl px-4 py-2.5 text-sm shadow-sm",
            outbound
              ? "rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-bl-sm border bg-card text-card-foreground",
          )}
        >
          <p className="whitespace-pre-wrap">{m.body}</p>
        </div>
      </div>
    </div>
  );
}
