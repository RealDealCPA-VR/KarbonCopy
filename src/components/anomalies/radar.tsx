"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Building2,
  CheckCheck,
  ChevronDown,
  Loader2,
  Radar as RadarIcon,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { AnomalyCard } from "./anomaly-card";
import { sevMeta } from "./severity";
import type { AnomalyItem, AnomalySeverity } from "./types";
import {
  dismissAnomaly,
  reopenAnomaly,
  reviewAllOpen,
  reviewAnomaly,
  runScan,
} from "@/app/(app)/anomalies/actions";

type StatusFilter = "open" | "reviewed" | "dismissed" | "all";
type SevFilter = "all" | AnomalySeverity;

export function Radar({
  initial,
  clients,
}: {
  initial: AnomalyItem[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  // Live-refresh when a books-health scan completes anywhere (scan.ts broadcasts
  // "anomaly_scan") — e.g. from another tab or a background trigger.
  useRealtimeEvent("anomaly_scan", () => router.refresh());
  const [items, setItems] = React.useState<AnomalyItem[]>(initial);
  const [status, setStatus] = React.useState<StatusFilter>("open");
  const [sev, setSev] = React.useState<SevFilter>("all");
  const [client, setClient] = React.useState<string>("all");
  const [scanClient, setScanClient] = React.useState<string>(clients[0]?.id ?? "");
  const [pending, setPending] = React.useState<Set<string>>(new Set());
  const [scanning, startScan] = React.useTransition();
  const [bulking, startBulk] = React.useTransition();

  React.useEffect(() => setItems(initial), [initial]);

  const setItemPending = (id: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const run = (
    id: string,
    optimistic: Partial<AnomalyItem>,
    fn: (id: string) => Promise<{ ok: boolean; error?: string }>,
    label: string,
  ) => {
    const prev = items.find((i) => i.id === id);
    setItemPending(id, true);
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...optimistic } : i)));
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

  const onReview = (id: string) =>
    run(id, { status: "reviewed" }, reviewAnomaly, "Marked reviewed");
  const onDismiss = (id: string) => run(id, { status: "dismissed" }, dismissAnomaly, "Dismissed");
  const onReopen = (id: string) => run(id, { status: "open" }, reopenAnomaly, "Re-opened");

  const onRunScan = () =>
    startScan(async () => {
      if (!scanClient) {
        toast.error("Pick a client to scan");
        return;
      }
      const res = await runScan(scanClient);
      if (!res.ok) {
        toast.error(res.error ?? "Scan failed");
        return;
      }
      const s = res.summary;
      if (s.created === 0) {
        toast.success(
          s.candidates > 0
            ? `Scan clean — ${s.duplicates} already flagged`
            : `Scanned ${s.scanned} txns, no new issues`,
        );
      } else {
        toast.success(
          `Found ${s.created} new anomal${s.created === 1 ? "y" : "ies"}` +
            (s.critical ? ` — ${s.critical} critical` : ""),
        );
      }
      router.refresh();
    });

  const onReviewAll = () =>
    startBulk(async () => {
      const orgScope = client !== "all" ? client : undefined;
      const res = await reviewAllOpen(orgScope);
      if (res.ok) {
        setItems((cur) =>
          cur.map((i) =>
            i.status === "open" && (!orgScope || i.organizationId === orgScope)
              ? { ...i, status: "reviewed" }
              : i,
          ),
        );
        toast.success("Open anomalies cleared");
      } else {
        toast.error(res.error ?? "Failed");
      }
    });

  const openCount = items.filter((i) => i.status === "open").length;

  const filtered = items.filter((i) => {
    if (status !== "all" && i.status !== status) return false;
    if (sev !== "all" && i.severity !== sev) return false;
    if (client !== "all" && i.organizationId !== client) return false;
    return true;
  });

  // group by client, sort groups by worst severity then open count
  const groups = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string; items: AnomalyItem[] }>();
    for (const it of filtered) {
      const key = it.organizationId ?? "__none";
      const g = map.get(key) ?? {
        id: key,
        name: it.clientName ?? "Unlinked",
        items: [],
      };
      g.items.push(it);
      map.set(key, g);
    }
    const arr = [...map.values()];
    for (const g of arr) {
      g.items.sort(
        (a, b) =>
          sevMeta(b.severity).rank - sevMeta(a.severity).rank ||
          new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
      );
    }
    arr.sort((a, b) => {
      const aWorst = Math.max(...a.items.map((i) => sevMeta(i.severity).rank));
      const bWorst = Math.max(...b.items.map((i) => sevMeta(i.severity).rank));
      return bWorst - aWorst || b.items.length - a.items.length;
    });
    return arr;
  }, [filtered]);

  const statusTabs: { value: StatusFilter; label: string; count?: number }[] = [
    { value: "open", label: "Open", count: openCount },
    { value: "reviewed", label: "Reviewed" },
    { value: "dismissed", label: "Dismissed" },
    { value: "all", label: "All" },
  ];

  return (
    <Card className="overflow-hidden">
      {/* control bar */}
      <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <TabsList>
            {statusTabs.map((t) => (
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

        <div className="flex flex-wrap items-center gap-2">
          <Select value={sev} onValueChange={(v) => setSev(v as SevFilter)}>
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>

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
            disabled={openCount === 0 || bulking}
            onClick={onReviewAll}
          >
            {bulking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" />
            )}
            Review {client !== "all" ? "client" : "all"}
          </Button>
        </div>
      </div>

      {/* run-scan strip */}
      <div className="flex flex-col gap-2 border-b bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ScanSearch className="h-4 w-4 text-primary" />
          Run a books-health scan against a client&rsquo;s ledger.
        </div>
        <div className="flex items-center gap-2">
          <Select value={scanClient} onValueChange={setScanClient}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="Choose client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="gap-1.5" disabled={scanning || !scanClient} onClick={onRunScan}>
            {scanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RadarIcon className="h-3.5 w-3.5" />
            )}
            Run scan
          </Button>
        </div>
      </div>

      {/* grouped list */}
      <div className="divide-y">
        {groups.length === 0 ? (
          <EmptyState status={status} />
        ) : (
          groups.map((g) => (
            <ClientGroupBlock
              key={g.id}
              group={g}
              pending={pending}
              onReview={onReview}
              onDismiss={onDismiss}
              onReopen={onReopen}
            />
          ))
        )}
      </div>
    </Card>
  );
}

function ClientGroupBlock({
  group,
  pending,
  onReview,
  onDismiss,
  onReopen,
}: {
  group: { id: string; name: string; items: AnomalyItem[] };
  pending: Set<string>;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onReopen: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(true);
  const counts = group.items.reduce(
    (acc, i) => {
      acc[i.severity] = (acc[i.severity] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-semibold">{group.name}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {counts.critical ? (
            <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
              {counts.critical} critical
            </Badge>
          ) : null}
          {counts.warning ? (
            <Badge variant="warning" className="h-5 px-1.5 text-[10px]">
              {counts.warning} warning
            </Badge>
          ) : null}
          {counts.info ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {counts.info} info
            </Badge>
          ) : null}
        </div>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4">
          {group.items.map((item) => (
            <AnomalyCard
              key={item.id}
              item={item}
              pending={pending.has(item.id)}
              onReview={onReview}
              onDismiss={onDismiss}
              onReopen={onReopen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ status }: { status: StatusFilter }) {
  const clean = status === "open" || status === "all";
  const Icon = clean ? ShieldCheck : RadarIcon;
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10 text-success">
        <Icon className="h-7 w-7" />
      </div>
      <div>
        <p className="font-medium">
          {clean ? "Books look clean" : `No ${status} anomalies`}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {clean
            ? "No open anomalies match your filters. Run a scan above to re-check a client's ledger."
            : "Nothing here for the current filters."}
        </p>
      </div>
    </div>
  );
}
