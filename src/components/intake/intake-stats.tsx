import { Loader2, FileCheck2, Link2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type IntakeStatsData = {
  pending: number;
  processed: number;
  matched: number;
  needsReview: number;
};

const CARDS = [
  { key: "pending", label: "In progress", icon: Loader2, tint: "text-blue-500" },
  { key: "processed", label: "Processed", icon: FileCheck2, tint: "text-foreground" },
  { key: "matched", label: "Auto-filed", icon: Link2, tint: "text-success" },
  { key: "needsReview", label: "Needs review", icon: AlertTriangle, tint: "text-amber-500" },
] as const;

export function IntakeStats({ stats }: { stats: IntakeStatsData }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {CARDS.map(({ key, label, icon: Icon, tint }) => (
        <Card key={key} className="flex items-center gap-3 p-4">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-muted", tint)}>
            <Icon className={cn("h-5 w-5", key === "pending" && stats.pending > 0 && "animate-spin")} />
          </div>
          <div>
            <div className="text-2xl font-bold leading-none tabular-nums">{stats[key]}</div>
            <div className="mt-1 text-xs text-muted-foreground">{label}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}
