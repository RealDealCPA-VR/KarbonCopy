import { CalendarDays, Sparkles, TrendingUp, Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export type AlertStats = {
  newToday: number;
  totalWeek: number;
  topClient: { name: string; count: number } | null;
  pendingNew: number;
};

export function StatsStrip({ stats }: { stats: AlertStats }) {
  const cards = [
    {
      label: "New today",
      value: stats.newToday,
      icon: Sparkles,
      tone: "primary" as const,
      sub: "files detected since midnight",
    },
    {
      label: "This week",
      value: stats.totalWeek,
      icon: CalendarDays,
      tone: "default" as const,
      sub: "total file events (7d)",
    },
    {
      label: "Awaiting review",
      value: stats.pendingNew,
      icon: TrendingUp,
      tone: stats.pendingNew > 0 ? ("warning" as const) : ("default" as const),
      sub: "unacknowledged alerts",
    },
    {
      label: "Top client",
      value: stats.topClient?.count ?? 0,
      icon: Building2,
      tone: "default" as const,
      sub: stats.topClient ? stats.topClient.name : "no activity yet",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="flex items-center gap-4 p-5">
            <div
              className={
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg " +
                (c.tone === "warning"
                  ? "bg-warning/15 text-warning"
                  : c.tone === "primary"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground")
              }
            >
              <c.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-bold tabular-nums">{c.value}</div>
              <div className="text-sm font-medium">{c.label}</div>
              <div className="truncate text-xs text-muted-foreground" title={c.sub}>
                {c.sub}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
