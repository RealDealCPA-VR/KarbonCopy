import {
  AlertOctagon,
  AlertTriangle,
  Info,
  Copy,
  CircleDollarSign,
  CalendarClock,
  FolderSearch,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnomalyKind, AnomalySeverity } from "./types";

export const severityMeta: Record<
  AnomalySeverity,
  {
    label: string;
    dot: string;
    bg: string;
    text: string;
    ring: string;
    badge: "destructive" | "warning" | "secondary";
    rank: number;
  }
> = {
  critical: {
    label: "Critical",
    dot: "bg-destructive",
    bg: "bg-destructive/10",
    text: "text-destructive",
    ring: "ring-destructive/40",
    badge: "destructive",
    rank: 2,
  },
  warning: {
    label: "Warning",
    dot: "bg-warning",
    bg: "bg-warning/15",
    text: "text-warning",
    ring: "ring-warning/40",
    badge: "warning",
    rank: 1,
  },
  info: {
    label: "Info",
    dot: "bg-primary",
    bg: "bg-primary/10",
    text: "text-primary",
    ring: "ring-primary/40",
    badge: "secondary",
    rank: 0,
  },
};

export function sevMeta(sev: AnomalySeverity | null | undefined) {
  return severityMeta[sev ?? "info"];
}

export const kindMeta: Record<string, { label: string; Icon: LucideIcon }> = {
  duplicate_payment: { label: "Duplicate payment", Icon: Copy },
  round_dollar: { label: "Round dollar", Icon: CircleDollarSign },
  backdated: { label: "Backdated entry", Icon: CalendarClock },
  uncategorized_spike: { label: "Uncategorized spike", Icon: FolderSearch },
  reconciliation_drift: { label: "Reconciliation drift", Icon: Scale },
};

export function kindLabel(kind: AnomalyKind | string) {
  return kindMeta[kind]?.label ?? kind;
}

export function KindIcon({ kind, className }: { kind: AnomalyKind | string; className?: string }) {
  const Icon = kindMeta[kind]?.Icon ?? Info;
  return <Icon className={cn("h-4 w-4", className)} />;
}

export function SeverityIcon({
  severity,
  className,
}: {
  severity: AnomalySeverity | null | undefined;
  className?: string;
}) {
  const sev = severity ?? "info";
  const Icon = sev === "critical" ? AlertOctagon : sev === "warning" ? AlertTriangle : Info;
  return <Icon className={cn("h-4 w-4", className)} />;
}
