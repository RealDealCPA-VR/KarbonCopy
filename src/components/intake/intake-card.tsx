"use client";

import * as React from "react";
import {
  FileText,
  Loader2,
  Link2,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  RefreshCw,
  X,
  Building2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DOC_TYPE_LABELS, DOC_TYPES, type DocType } from "@/lib/ocr";
import type { IntakeItem, OpenRequest } from "./types";

const STATUS_META: Record<
  IntakeItem["status"],
  { label: string; icon: React.ElementType; cls: string }
> = {
  pending: { label: "Queued", icon: Loader2, cls: "text-blue-500" },
  processing: { label: "Reading…", icon: Loader2, cls: "text-blue-500" },
  processed: { label: "Processed", icon: CheckCircle2, cls: "text-foreground" },
  matched: { label: "Auto-filed", icon: Link2, cls: "text-success" },
  failed: { label: "Skipped", icon: AlertTriangle, cls: "text-muted-foreground" },
};

function confidenceTone(c: number | null): string {
  if (c == null) return "text-muted-foreground";
  if (c >= 0.8) return "text-success";
  if (c >= 0.6) return "text-foreground";
  return "text-amber-500";
}

const HIDDEN_FIELDS = new Set(["headerLine"]);

export function IntakeCard({
  item,
  openRequests,
  pending,
  onCorrectType,
  onConfirmMatch,
  onReprocess,
  onDismiss,
}: {
  item: IntakeItem;
  openRequests: OpenRequest[];
  pending: boolean;
  onCorrectType: (id: string, docType: DocType) => void;
  onConfirmMatch: (id: string, requestId: string) => void;
  onReprocess: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [editType, setEditType] = React.useState(false);
  const busy = item.status === "pending" || item.status === "processing";
  const meta = STATUS_META[item.status];
  const Icon = meta.icon;

  // candidate requests for this item's org (or all if none resolved)
  const candidates = openRequests.filter(
    (r) => !item.organizationId || r.organizationId === item.organizationId,
  );

  const fields = item.extractedFields ?? {};
  const fieldEntries = Object.entries(fields).filter(
    ([k, v]) => !HIDDEN_FIELDS.has(k) && v != null && v !== "",
  );

  return (
    <Card
      className={cn(
        "flex flex-col gap-3 p-4 transition-colors",
        item.status === "matched" && "border-success/40",
        busy && "opacity-90",
      )}
    >
      {/* header row */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium" title={item.sourcePath}>
              {item.fileName}
            </span>
            <span className={cn("inline-flex items-center gap-1 text-xs font-medium", meta.cls)}>
              <Icon className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
              {meta.label}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {item.clientName ? (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                {item.clientName}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-500">
                <Building2 className="h-3.5 w-3.5" />
                Unmatched client
              </span>
            )}
            {item.engine ? <span>via {item.engine}</span> : null}
          </div>
        </div>

        {/* doc type + confidence */}
        <div className="flex shrink-0 items-center gap-2">
          {editType ? (
            <Select
              defaultValue={item.docType ?? "unknown"}
              onValueChange={(v) => {
                setEditType(false);
                onCorrectType(item.id, v as DocType);
              }}
            >
              <SelectTrigger className="h-8 w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((dt) => (
                  <SelectItem key={dt} value={dt}>
                    {DOC_TYPE_LABELS[dt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <button
              type="button"
              className="group inline-flex items-center gap-1.5"
              onClick={() => setEditType(true)}
              title="Correct document type"
              disabled={busy}
            >
              <Badge variant={item.docType && item.docType !== "unknown" ? "default" : "secondary"}>
                {item.docType ? DOC_TYPE_LABELS[item.docType] : "—"}
              </Badge>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          {item.confidence != null ? (
            <span
              className={cn("w-10 text-right text-xs font-semibold tabular-nums", confidenceTone(item.confidence))}
              title="Classification confidence"
            >
              {Math.round(item.confidence * 100)}%
            </span>
          ) : null}
        </div>
      </div>

      {/* extracted fields */}
      {fieldEntries.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pl-[3.25rem]">
          {fieldEntries.slice(0, 8).map(([k, v]) => (
            <span
              key={k}
              className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              <span className="font-medium text-foreground/70">{k}:</span> {String(v)}
            </span>
          ))}
        </div>
      ) : null}

      {/* match / actions row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="min-w-0 flex-1">
          {item.matchedRequestId ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-success">
              <Link2 className="h-4 w-4" />
              Filed to{" "}
              <span className="font-medium">{item.matchedRequestTitle ?? "request"}</span>
            </span>
          ) : (
            <MatchPicker
              candidates={candidates}
              disabled={busy || pending}
              onPick={(rid) => onConfirmMatch(item.id, rid)}
            />
          )}
          {item.error && item.status === "failed" ? (
            <p className="mt-1 text-xs text-muted-foreground">{item.error}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {item.matchedRequestId ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={pending}
              onClick={() => onConfirmMatch(item.id, "")}
            >
              <X className="h-3.5 w-3.5" />
              Unmatch
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={pending || busy}
            onClick={() => onReprocess(item.id)}
            title="Re-run OCR + classification"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Re-run
          </Button>
          {item.status !== "matched" ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              disabled={pending}
              onClick={() => onDismiss(item.id)}
            >
              <X className="h-3.5 w-3.5" />
              Dismiss
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function MatchPicker({
  candidates,
  disabled,
  onPick,
}: {
  candidates: OpenRequest[];
  disabled: boolean;
  onPick: (requestId: string) => void;
}) {
  if (candidates.length === 0) {
    return <span className="text-sm text-muted-foreground">No open requests to match.</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Match to request:</span>
      <Select disabled={disabled} onValueChange={onPick}>
        <SelectTrigger className="h-8 w-[240px]">
          <SelectValue placeholder="Pick a request…" />
        </SelectTrigger>
        <SelectContent>
          {candidates.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
