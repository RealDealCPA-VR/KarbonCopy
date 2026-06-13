"use client";

import * as React from "react";
import { BellRing, Loader2, Radio, CheckCheck, FolderSearch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useRealtime, useRealtimeEvent } from "@/lib/realtime-client";
import { cn } from "@/lib/utils";
import { AlertCard } from "./alert-card";
import type { AlertItem, FileEventPayload } from "./types";
import {
  acknowledgeAllNew,
  acknowledgeEvent,
  dismissEvent,
  restoreEvent,
} from "@/app/(app)/alerts/actions";

type Filter = "all" | "new" | "acknowledged";

export function AlertFeed({
  initial,
  clients,
}: {
  initial: AlertItem[];
  clients: { id: string; name: string }[];
}) {
  const [items, setItems] = React.useState<AlertItem[]>(initial);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [client, setClient] = React.useState<string>("all");
  const [pending, setPending] = React.useState<Set<string>>(new Set());
  const [bulkPending, startBulk] = React.useTransition();
  const { socket } = useRealtime();

  // Prepend brand-new events arriving over the wire.
  useRealtimeEvent<FileEventPayload>("file_event", (e) => {
    setItems((prev) => {
      if (prev.some((p) => p.id === e.id)) return prev;
      const next: AlertItem = {
        id: e.id,
        event: e.event,
        filePath: e.filePath,
        fileName: e.fileName,
        sizeBytes: e.sizeBytes ?? null,
        status: e.status ?? "new",
        organizationId: e.organizationId ?? null,
        workItemId: e.workItemId ?? null,
        acknowledgedById: null,
        acknowledgedAt: null,
        detectedAt: e.detectedAt ?? Date.now(),
        clientName: e.clientName ?? null,
        ruleName: null,
        severity: e.severity ?? "info",
        message: e.message,
        isLive: true,
      };
      // clear the live flag after the highlight settles
      window.setTimeout(
        () => setItems((cur) => cur.map((i) => (i.id === e.id ? { ...i, isLive: false } : i))),
        6000,
      );
      return [next, ...prev];
    });
  });

  const setItemPending = (id: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });

  // optimistic single-item mutation wrapper
  const run = (
    id: string,
    optimistic: Partial<AlertItem>,
    fn: (id: string) => Promise<{ ok: boolean; error?: string }>,
    label: string,
  ) => {
    const prev = items.find((i) => i.id === id);
    setItemPending(id, true);
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...optimistic, isLive: false } : i)));
    fn(id)
      .then((res) => {
        if (!res.ok) {
          setItems((cur) => (prev ? cur.map((i) => (i.id === id ? prev : i)) : cur));
          toast.error(res.error ?? "Action failed");
        } else {
          toast.success(label);
        }
      })
      .catch(() => {
        setItems((cur) => (prev ? cur.map((i) => (i.id === id ? prev : i)) : cur));
        toast.error("Action failed");
      })
      .finally(() => setItemPending(id, false));
  };

  const onAck = (id: string) =>
    run(id, { status: "acknowledged" }, acknowledgeEvent, "Alert acknowledged");
  const onDismiss = (id: string) =>
    run(id, { status: "dismissed" }, dismissEvent, "Alert dismissed");
  const onRestore = (id: string) => run(id, { status: "new" }, restoreEvent, "Moved back to new");

  const ackAll = () =>
    startBulk(async () => {
      const res = await acknowledgeAllNew();
      if (res.ok) {
        setItems((cur) =>
          cur.map((i) => (i.status === "new" ? { ...i, status: "acknowledged", isLive: false } : i)),
        );
        toast.success("All new alerts acknowledged");
      } else {
        toast.error(res.error ?? "Failed");
      }
    });

  const newCount = items.filter((i) => i.status === "new").length;

  const filtered = items.filter((i) => {
    if (filter === "new" && i.status !== "new") return false;
    if (filter === "acknowledged" && i.status !== "acknowledged") return false;
    if (client !== "all" && i.organizationId !== client) return false;
    return true;
  });

  const tabs: { value: Filter; label: string; count?: number }[] = [
    { value: "all", label: "All" },
    { value: "new", label: "New", count: newCount },
    { value: "acknowledged", label: "Acknowledged" },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              {tabs.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
                  {t.label}
                  {t.count ? (
                    <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4 text-primary-foreground">
                      {t.count}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span
            className={cn(
              "hidden items-center gap-1.5 text-xs font-medium md:inline-flex",
              socket ? "text-success" : "text-muted-foreground",
            )}
            title={socket ? "Connected — receiving live alerts" : "Connecting…"}
          >
            <Radio className={cn("h-3.5 w-3.5", socket && "animate-pulse")} />
            {socket ? "Live" : "Offline"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Select value={client} onValueChange={setClient}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={newCount === 0 || bulkPending}
            onClick={ackAll}
          >
            {bulkPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" />
            )}
            Acknowledge all
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {filtered.length === 0 ? (
          <EmptyState filter={filter} clientFiltered={client !== "all"} />
        ) : (
          filtered.map((item) => (
            <AlertCard
              key={item.id}
              item={item}
              pending={pending.has(item.id)}
              onAcknowledge={onAck}
              onDismiss={onDismiss}
              onRestore={onRestore}
            />
          ))
        )}
      </div>
    </Card>
  );
}

function EmptyState({ filter, clientFiltered }: { filter: Filter; clientFiltered: boolean }) {
  const Icon = filter === "new" ? CheckCheck : clientFiltered ? FolderSearch : BellRing;
  const title =
    filter === "new"
      ? "Inbox zero — no new alerts"
      : clientFiltered
        ? "No alerts for this client"
        : "No file alerts yet";
  const sub =
    filter === "new"
      ? "You're all caught up. New file-server events will appear here in real time."
      : clientFiltered
        ? "Try a different client or clear the filter."
        : "Configure watched folders and rules in Settings to start catching completed files automatically.";
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="h-7 w-7" />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

export function AlertFeedSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-xl border bg-card p-4">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
