"use client";

import * as React from "react";
import { ScanLine, Radio, Inbox } from "lucide-react";
import { toast } from "sonner";
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
import { IntakeCard } from "./intake-card";
import type { IntakeItem, OpenRequest, ExtractionPayload } from "./types";
import type { DocType } from "@/lib/ocr";
import {
  correctDocType,
  confirmMatch,
  reprocess,
  dismissExtraction,
} from "@/app/(app)/intake/actions";

type Filter = "all" | "review" | "matched" | "queued";

export function IntakeQueue({
  initial,
  openRequests,
  clients,
}: {
  initial: IntakeItem[];
  openRequests: OpenRequest[];
  clients: { id: string; name: string }[];
}) {
  const [items, setItems] = React.useState<IntakeItem[]>(initial);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [client, setClient] = React.useState<string>("all");
  const [pending, setPending] = React.useState<Set<string>>(new Set());
  const { socket } = useRealtime();

  // Live updates from the on-prem pipeline.
  useRealtimeEvent<ExtractionPayload>("extraction", (e) => {
    setItems((prev) => {
      const existing = prev.find((p) => p.id === e.id);
      if (existing) {
        return prev.map((p) =>
          p.id === e.id
            ? {
                ...p,
                status: e.status ?? p.status,
                docType: (e.docType as DocType) ?? p.docType,
                confidence: e.confidence ?? p.confidence,
                matchedRequestId: e.matchedRequestId ?? p.matchedRequestId,
              }
            : p,
        );
      }
      // brand-new extraction row
      const next: IntakeItem = {
        id: e.id,
        sourcePath: e.sourcePath ?? e.fileName ?? "",
        fileName: e.fileName ?? (e.sourcePath ? e.sourcePath.split(/[/\\]/).pop()! : "New document"),
        docType: (e.docType as DocType) ?? null,
        confidence: e.confidence ?? null,
        status: e.status ?? "pending",
        extractedFields: null,
        organizationId: e.organizationId ?? null,
        clientName: null,
        matchedRequestId: e.matchedRequestId ?? null,
        matchedRequestTitle: null,
        engine: null,
        error: null,
        createdAt: Date.now(),
        processedAt: null,
      };
      return [next, ...prev];
    });
  });

  const setItemPending = (id: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });

  const run = (
    id: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
    label: string,
  ) => {
    setItemPending(id, true);
    fn()
      .then((res) => {
        if (!res.ok) toast.error(res.error ?? "Action failed");
        else toast.success(label);
      })
      .catch(() => toast.error("Action failed"))
      .finally(() => setItemPending(id, false));
  };

  const onCorrectType = (id: string, docType: DocType) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, docType, confidence: 1 } : i)));
    run(id, () => correctDocType(id, docType), "Document type updated");
  };

  const onConfirmMatch = (id: string, requestId: string) => {
    const req = openRequests.find((r) => r.id === requestId);
    setItems((cur) =>
      cur.map((i) =>
        i.id === id
          ? {
              ...i,
              status: requestId ? "matched" : "processed",
              matchedRequestId: requestId || null,
              matchedRequestTitle: req?.title ?? null,
            }
          : i,
      ),
    );
    run(id, () => confirmMatch(id, requestId), requestId ? "Document filed" : "Match cleared");
  };

  const onReprocess = (id: string) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, status: "pending", error: null } : i)));
    run(id, () => reprocess(id), "Re-queued for OCR");
  };

  const onDismiss = (id: string) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, status: "failed", error: "Dismissed by staff" } : i)));
    run(id, () => dismissExtraction(id), "Dismissed");
  };

  const reviewCount = items.filter(
    (i) => i.status === "processed" && (i.docType === "unknown" || (i.confidence ?? 0) < 0.6),
  ).length;

  const filtered = items.filter((i) => {
    if (client !== "all" && i.organizationId !== client) return false;
    if (filter === "matched") return i.status === "matched";
    if (filter === "queued") return i.status === "pending" || i.status === "processing";
    if (filter === "review")
      return i.status === "processed" && (i.docType === "unknown" || (i.confidence ?? 0) < 0.6);
    return true;
  });

  const tabs: { value: Filter; label: string; count?: number }[] = [
    { value: "all", label: "All" },
    { value: "review", label: "Needs review", count: reviewCount },
    { value: "matched", label: "Auto-filed" },
    { value: "queued", label: "In progress" },
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
                    <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold leading-4 text-white">
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
            title={socket ? "Connected — live intake updates" : "Connecting…"}
          >
            <Radio className={cn("h-3.5 w-3.5", socket && "animate-pulse")} />
            {socket ? "Live" : "Offline"}
          </span>
        </div>

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
      </div>

      <div className="space-y-3 p-4">
        {filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          filtered.map((item) => (
            <IntakeCard
              key={item.id}
              item={item}
              openRequests={openRequests}
              pending={pending.has(item.id)}
              onCorrectType={onCorrectType}
              onConfirmMatch={onConfirmMatch}
              onReprocess={onReprocess}
              onDismiss={onDismiss}
            />
          ))
        )}
      </div>
    </Card>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const Icon = filter === "all" ? ScanLine : Inbox;
  const title =
    filter === "review"
      ? "Nothing needs review"
      : filter === "matched"
        ? "No auto-filed documents yet"
        : filter === "queued"
          ? "Nothing in the queue"
          : "No documents have landed yet";
  const sub =
    filter === "all"
      ? "When a file lands on a watched share or is uploaded, on-prem OCR reads it, classifies it, and files it to the right request — automatically."
      : "Switch filters or watch for new documents arriving in real time.";
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="h-7 w-7" />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

export function IntakeQueueSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-xl border bg-card p-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
