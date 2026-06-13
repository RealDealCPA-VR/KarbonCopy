"use client";

import * as React from "react";
import { Search, Plus, Inbox } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/clients/user-avatar";
import { cn } from "@/lib/utils";
import { STATUS_META, type FilterTab, type ThreadRow } from "./types";

const TABS: { value: FilterTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
  { value: "waiting", label: "Waiting" },
  { value: "closed", label: "Closed" },
];

export function ThreadList({
  threads,
  currentUserId,
  selectedId,
  onSelect,
  onNew,
  tab,
  onTabChange,
}: {
  threads: ThreadRow[];
  currentUserId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  tab: FilterTab;
  onTabChange: (t: FilterTab) => void;
}) {
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => {
      if (tab === "mine" && t.assigneeId !== currentUserId) return false;
      if (tab === "unassigned" && t.assigneeId != null) return false;
      if (tab === "waiting" && t.status !== "waiting") return false;
      if (tab === "closed" && t.status !== "closed") return false;
      // "all" hides closed unless searching, to keep the queue clean
      if (tab === "all" && t.status === "closed" && !q) return false;
      if (!q) return true;
      return (
        t.subject.toLowerCase().includes(q) ||
        (t.preview ?? "").toLowerCase().includes(q) ||
        (t.orgName ?? "").toLowerCase().includes(q) ||
        (t.contactName ?? "").toLowerCase().includes(q)
      );
    });
  }, [threads, tab, query, currentUserId]);

  const counts = React.useMemo(() => {
    return {
      all: threads.filter((t) => t.status !== "closed").length,
      mine: threads.filter((t) => t.assigneeId === currentUserId && t.status !== "closed").length,
      unassigned: threads.filter((t) => t.assigneeId == null && t.status !== "closed").length,
      waiting: threads.filter((t) => t.status === "waiting").length,
      closed: threads.filter((t) => t.status === "closed").length,
    } as Record<FilterTab, number>;
  }, [threads, currentUserId]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold tracking-tight">Triage</h1>
          <Button size="sm" onClick={onNew}>
            <Plus className="h-4 w-4" /> New
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads…"
            className="pl-9"
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as FilterTab)}>
          <TabsList className="grid w-full grid-cols-5">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="px-1.5 text-xs">
                {t.label}
                {counts[t.value] > 0 && (
                  <span className="ml-1 hidden rounded bg-muted-foreground/15 px-1 text-[10px] tabular-nums sm:inline">
                    {counts[t.value]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Inbox className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium">Nothing here</p>
            <p className="text-xs text-muted-foreground">
              {query ? "No threads match your search." : "This queue is empty. Inbox zero! 🎉"}
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {filtered.map((t) => {
              const active = t.id === selectedId;
              const unlinked = !t.assigneeId;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(t.id)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors focus:outline-none focus-visible:bg-accent",
                      active ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {unlinked && t.status !== "closed" && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unassigned" />
                          )}
                          <span className="truncate text-sm font-semibold">{t.subject}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {t.orgName ?? t.contactName ?? "No client linked"}
                        </p>
                        {t.preview && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                            {t.preview}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <Badge variant={STATUS_META[t.status].badge} className="text-[10px]">
                            {STATUS_META[t.status].label}
                          </Badge>
                          {t.workItemId && (
                            <Badge variant="outline" className="text-[10px]">
                              Work linked
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {t.lastMessageAt && (
                          <span className="text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(t.lastMessageAt), { addSuffix: true })}
                          </span>
                        )}
                        {t.assignee && <UserAvatar user={t.assignee} className="h-6 w-6" />}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
