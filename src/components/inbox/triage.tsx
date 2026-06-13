"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inbox, MailQuestion, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThreadList } from "./thread-list";
import { Conversation } from "./conversation";
import { ContextPanel } from "./context-panel";
import { NewThreadDialog } from "./new-thread-dialog";
import type {
  FilterTab,
  ThreadRow,
  ThreadDetail,
  UserLite,
  OrgLite,
  ContactLite,
  WorkLite,
} from "./types";

export function Triage({
  threads,
  detailsById,
  users,
  organizations,
  contacts,
  workItems,
  currentUserId,
  aiEnabled,
  initialThreadId,
}: {
  threads: ThreadRow[];
  detailsById: Record<string, ThreadDetail>;
  users: UserLite[];
  organizations: OrgLite[];
  contacts: ContactLite[];
  workItems: WorkLite[];
  currentUserId: string;
  aiEnabled: boolean;
  initialThreadId: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = React.useState<FilterTab>("all");

  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialThreadId && detailsById[initialThreadId] ? initialThreadId : null,
  );

  // Keep selection valid after server refreshes (e.g. thread filtered out).
  React.useEffect(() => {
    if (selectedId && !detailsById[selectedId]) setSelectedId(null);
  }, [detailsById, selectedId]);

  const selected = selectedId ? detailsById[selectedId] ?? null : null;

  function select(id: string) {
    setSelectedId(id);
    // Reflect selection in the URL without a full navigation.
    const sp = new URLSearchParams(params.toString());
    sp.set("thread", id);
    router.replace(`/inbox?${sp.toString()}`, { scroll: false });
  }

  const [dialogOpen, setDialogOpen] = React.useState(false);

  if (threads.length === 0) {
    return (
      <>
        <EmptyInbox onNew={() => setDialogOpen(true)} />
        <NewThreadDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          organizations={organizations}
          onCreated={(id) => select(id)}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex h-[calc(100vh-7.5rem)] overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Left: thread list */}
        <div
          className={cn(
            "w-full shrink-0 border-r md:w-80 lg:w-96",
            selected ? "hidden md:flex md:flex-col" : "flex flex-col",
          )}
        >
          <ThreadList
            threads={threads}
            currentUserId={currentUserId}
            selectedId={selectedId}
            onSelect={select}
            onNew={() => setDialogOpen(true)}
            tab={tab}
            onTabChange={setTab}
          />
        </div>

        {/* Middle: conversation */}
        <div className={cn("min-w-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")}>
          {selected ? (
            <Conversation
              key={selected.id}
              thread={selected}
              users={users}
              organizations={organizations}
              contacts={contacts}
              workItems={workItems}
              currentUserId={currentUserId}
              aiEnabled={aiEnabled}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <NoSelection />
          )}
        </div>

        {/* Right: context panel */}
        {selected && (
          <div className="hidden w-72 shrink-0 border-l xl:block">
            <ContextPanel
              thread={selected}
              users={users}
              organizations={organizations}
              contacts={contacts}
              workItems={workItems}
            />
          </div>
        )}
      </div>

      <NewThreadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organizations={organizations}
        onCreated={(id) => select(id)}
      />
    </>
  );
}

function NoSelection() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <MailQuestion className="h-7 w-7" />
      </div>
      <div>
        <p className="font-semibold">Select a thread</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Pick a conversation from the queue to read it, reply, assign it, or turn it into work.
        </p>
      </div>
    </div>
  );
}

function EmptyInbox({ onNew }: { onNew: () => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Triage</h1>
        <p className="text-muted-foreground">Your firm&apos;s shared inbox.</p>
      </div>
      <div className="rounded-xl border border-dashed bg-card">
        <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Inbox className="h-8 w-8" />
          </div>
          <div className="max-w-md space-y-1.5">
            <p className="text-lg font-semibold">Triage every client message in one place</p>
            <p className="text-sm text-muted-foreground">
              Threads land here so the whole team can see what&apos;s open. Assign owners, set a
              status (open, waiting, closed), link the right client and work item, and reply or drop
              an internal note — without anything falling through the cracks. With an Anthropic key,
              Claude can draft replies, summarize long threads, and pull out action items.
            </p>
          </div>
          <Button onClick={onNew} className="mt-1">
            <Plus className="h-4 w-4" /> New thread
          </Button>
          <p className="text-xs text-muted-foreground">
            No threads yet — create one to see triage in action.
          </p>
        </div>
      </div>
    </div>
  );
}
