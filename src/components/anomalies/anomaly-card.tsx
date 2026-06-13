"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Check, CornerUpLeft, ExternalLink, MoreHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatMoneyCents } from "@/lib/utils";
import type { AnomalyItem } from "./types";
import { KindIcon, kindLabel, sevMeta } from "./severity";

function relTime(d: AnomalyItem["detectedAt"]) {
  try {
    return formatDistanceToNow(new Date(d), { addSuffix: true });
  } catch {
    return "just now";
  }
}

export function AnomalyCard({
  item,
  pending,
  onReview,
  onDismiss,
  onReopen,
}: {
  item: AnomalyItem;
  pending?: boolean;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onReopen: (id: string) => void;
}) {
  const meta = sevMeta(item.severity);

  return (
    <div
      className={cn(
        "group relative flex gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all",
        "hover:border-border hover:shadow-md",
        item.severity === "critical" && item.status === "open" && "border-destructive/30",
        item.status === "dismissed" && "opacity-60",
        pending && "pointer-events-none opacity-50",
      )}
    >
      <div className="flex shrink-0 flex-col items-center">
        <span
          className={cn("flex h-9 w-9 items-center justify-center rounded-lg", meta.bg, meta.text)}
        >
          <KindIcon kind={item.kind} />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium leading-tight">{item.title}</span>
              <Badge variant={meta.badge} className="h-5 shrink-0 px-1.5 text-[10px]">
                {meta.label}
              </Badge>
              <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] font-normal">
                {kindLabel(item.kind)}
              </Badge>
              {item.status === "reviewed" && (
                <Badge variant="secondary" className="h-5 shrink-0 gap-1 px-1.5 text-[10px]">
                  <Check className="h-3 w-3" /> Reviewed
                </Badge>
              )}
              {item.status === "dismissed" && (
                <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
                  Dismissed
                </Badge>
              )}
            </div>
            {item.detail && (
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {item.status === "open" ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-success"
                      onClick={() => onReview(item.id)}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Mark reviewed</TooltipContent>
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
                  <TooltipContent>Dismiss (false positive)</TooltipContent>
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
                  <DropdownMenuItem onClick={() => onReopen(item.id)}>
                    <CornerUpLeft className="mr-2 h-4 w-4" /> Re-open
                  </DropdownMenuItem>
                  {item.status !== "dismissed" && (
                    <DropdownMenuItem onClick={() => onDismiss(item.id)}>
                      <X className="mr-2 h-4 w-4" /> Dismiss
                    </DropdownMenuItem>
                  )}
                  {item.status !== "reviewed" && (
                    <DropdownMenuItem onClick={() => onReview(item.id)}>
                      <Check className="mr-2 h-4 w-4" /> Mark reviewed
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {item.amountCents != null && (
            <span className="font-medium tabular-nums text-foreground/80">
              {formatMoneyCents(item.amountCents)}
            </span>
          )}
          <span className="capitalize">{item.source}</span>
          <span className="tabular-nums" title={new Date(item.detectedAt).toLocaleString()}>
            {relTime(item.detectedAt)}
          </span>
          {item.organizationId && (
            <Link
              href={`/clients/${item.organizationId}`}
              className="ml-auto inline-flex items-center gap-1 text-primary opacity-0 transition-opacity group-hover:opacity-100 hover:underline"
            >
              Open client
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
