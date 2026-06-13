import { CheckCircle2, FileText, FilePlus2, FileX2, FolderPlus, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileRuleEvent } from "@/db/schema";
import type { Severity } from "./types";

export const severityMeta: Record<
  Severity,
  { label: string; dot: string; bg: string; text: string; ring: string; badge: "success" | "warning" | "secondary" }
> = {
  success: {
    label: "Success",
    dot: "bg-success",
    bg: "bg-success/10",
    text: "text-success",
    ring: "ring-success/40",
    badge: "success",
  },
  warning: {
    label: "Warning",
    dot: "bg-warning",
    bg: "bg-warning/15",
    text: "text-warning",
    ring: "ring-warning/40",
    badge: "warning",
  },
  info: {
    label: "Info",
    dot: "bg-primary",
    bg: "bg-primary/10",
    text: "text-primary",
    ring: "ring-primary/40",
    badge: "secondary",
  },
};

export function metaFor(sev: Severity | null | undefined) {
  return severityMeta[sev ?? "info"];
}

const eventMeta: Record<FileRuleEvent, { label: string; Icon: typeof FileText }> = {
  add: { label: "Added", Icon: FilePlus2 },
  change: { label: "Changed", Icon: FileText },
  unlink: { label: "Removed", Icon: FileX2 },
  addDir: { label: "New folder", Icon: FolderPlus },
};

export function eventLabel(event: FileRuleEvent) {
  return eventMeta[event]?.label ?? event;
}

export function SeverityIcon({
  severity,
  event,
  className,
}: {
  severity: Severity | null | undefined;
  event?: FileRuleEvent;
  className?: string;
}) {
  const sev = severity ?? "info";
  if (event && eventMeta[event]) {
    const { Icon } = eventMeta[event];
    return <Icon className={cn("h-4 w-4", className)} />;
  }
  const Icon = sev === "warning" ? AlertTriangle : sev === "success" ? CheckCircle2 : Info;
  return <Icon className={cn("h-4 w-4", className)} />;
}
