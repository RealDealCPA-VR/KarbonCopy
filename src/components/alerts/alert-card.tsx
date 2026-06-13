"use client";

import * as React from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Building2,
  Check,
  CornerUpLeft,
  ExternalLink,
  Folder,
  MoreHorizontal,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AlertItem } from "./types";
import { eventLabel, metaFor, SeverityIcon } from "./severity";

function fmtSize(bytes: number | null | undefined) {
  if (!bytes && bytes !== 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function relTime(d: AlertItem["detectedAt"]) {
  try {
    return formatDistanceToNow(new Date(d), { addSuffix: true });
  } catch {
    return "just now";
  }
}

export function AlertCard({
  item,
  pending,
  onAcknowledge,
  onDismiss,
  onRestore,
}: {
  item: AlertItem;
  pending?: boolean;
  onAcknowledge: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const meta = metaFor(item.severity);
  const folder = React.useMemo(() => {
    const parts = item.filePath.split(/[/\\]/).filter(Boolean);
    parts.pop();
    return parts.slice(-2).join(" / ");
  }, [item.filePath]);

  const link = item.workItemId
    ? `/work/${item.workItemId}`
    : item.organizationId
      ? `/clients/${item.organizationId}`
      : null;

  return (
    <div
      className={cn(
        "group relative flex gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all",
        "hover:shadow-md hover:border-border",
        item.status === "dismissed" && "opacity-60",
        item.isLive && "ring-2 ring-offset-2 ring-offset-background animate-in fade-in slide-in-from-top-2",
        item.isLive && meta.ring,
        pending && "pointer-events-none opacity-50",
      )}
    >
      {/* severity rail */}
      <div className="relative flex shrink-0 flex-col items-center">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            meta.bg,
            meta.text,
          )}
        >
          <SeverityIcon severity={item.severity} event={item.event} />
        </span>
        {item.isLive && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card",
              meta.dot,
            )}
          >
            <span className={cn("absolute inset-0 rounded-full animate-pulse-ring", meta.dot)} />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium leading-tight" title={item.fileName}>
                {item.fileName}
              </span>
              {item.status === "new" && (
                <Badge variant={meta.badge} className="h-5 shrink-0 px-1.5 text-[10px]">
                  New
                </Badge>
              )}
              {item.status === "acknowledged" && (
                <Badge variant="outline" className="h-5 shrink-0 gap-1 px-1.5 text-[10px]">
                  <Check className="h-3 w-3" /> Ack
                </Badge>
              )}
              {item.status === "dismissed" && (
                <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
                  Dismissed
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {item.message ?? item.ruleName ?? `File ${eventLabel(item.event).toLowerCase()}`}
            </p>
          </div>

          {/* per-card actions */}
          <div className="flex shrink-0 items-center gap-1">
            {item.status === "new" ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-success"
                      onClick={() => onAcknowledge(item.id)}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Acknowledge</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => onDismiss(item.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Dismiss</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onRestore(item.id)}>
                    <CornerUpLeft className="mr-2 h-4 w-4" /> Mark as new
                  </DropdownMenuItem>
                  {item.status !== "dismissed" && (
                    <DropdownMenuItem onClick={() => onDismiss(item.id)}>
                      <X className="mr-2 h-4 w-4" /> Dismiss
                    </DropdownMenuItem>
                  )}
                  {item.status !== "acknowledged" && (
                    <DropdownMenuItem onClick={() => onAcknowledge(item.id)}>
                      <Check className="mr-2 h-4 w-4" /> Acknowledge
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* meta row */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {item.clientName ? (
            <Link
              href={item.organizationId ? `/clients/${item.organizationId}` : "#"}
              className="inline-flex items-center gap-1 font-medium text-foreground/80 hover:text-primary hover:underline"
            >
              <Building2 className="h-3.5 w-3.5" /> {item.clientName}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 italic">
              <Building2 className="h-3.5 w-3.5" /> Unlinked
            </span>
          )}
          {folder && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Folder className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate" title={item.filePath}>
                {folder}
              </span>
            </span>
          )}
          {fmtSize(item.sizeBytes) && <span className="tabular-nums">{fmtSize(item.sizeBytes)}</span>}
          <span className="tabular-nums" title={new Date(item.detectedAt).toLocaleString()}>
            {relTime(item.detectedAt)}
          </span>
          {link && (
            <Link
              href={link}
              className="ml-auto inline-flex items-center gap-1 text-primary opacity-0 transition-opacity group-hover:opacity-100 hover:underline"
            >
              {item.workItemId ? "Open work item" : "Open client"}
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
