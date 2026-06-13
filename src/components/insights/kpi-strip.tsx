import {
  Briefcase,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Clock,
  Gauge,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatMinutes, formatMoneyCents } from "@/lib/utils";
import { PERIOD_LABELS, type Kpi, type Period } from "./types";

type Tone = "default" | "destructive" | "warning" | "success";

const toneClass: Record<Tone, string> = {
  default: "bg-primary/10 text-primary",
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
};

export function KpiStrip({ kpi, period }: { kpi: Kpi; period: Period }) {
  const periodLabel = PERIOD_LABELS[period].toLowerCase();
  const cards: { label: string; value: string; icon: LucideIcon; tone: Tone }[] = [
    { label: "Open work", value: String(kpi.openWork), icon: Briefcase, tone: "default" },
    { label: "Overdue", value: String(kpi.overdue), icon: AlertTriangle, tone: "destructive" },
    {
      label: `Completed ${periodLabel}`,
      value: String(kpi.completedThisPeriod),
      icon: CheckCircle2,
      tone: "success",
    },
    { label: "WIP value", value: formatMoneyCents(kpi.wipValueCents), icon: DollarSign, tone: "default" },
    {
      label: `Billable ${periodLabel}`,
      value: formatMinutes(kpi.billableMinutes),
      icon: Clock,
      tone: "default",
    },
    {
      label: "Realization",
      value: kpi.realizationPct == null ? "—" : `${kpi.realizationPct}%`,
      icon: Gauge,
      tone: kpi.realizationPct == null ? "default" : kpi.realizationPct >= 80 ? "success" : "warning",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => (
        <Card key={c.label} className="transition-shadow hover:shadow-md">
          <CardContent className="flex items-center gap-3 p-5">
            <div className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-lg " + toneClass[c.tone]}>
              <c.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-2xl font-bold tabular-nums">{c.value}</div>
              <div className="truncate text-sm text-muted-foreground">{c.label}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
