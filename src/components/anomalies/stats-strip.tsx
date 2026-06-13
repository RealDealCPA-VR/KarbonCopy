import { AlertOctagon, AlertTriangle, Info, Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export type AnomalyStats = {
  openCritical: number;
  openWarning: number;
  openInfo: number;
  clientsAffected: number;
};

export function StatsStrip({ stats }: { stats: AnomalyStats }) {
  const cards = [
    {
      label: "Critical",
      value: stats.openCritical,
      icon: AlertOctagon,
      tone: stats.openCritical > 0 ? ("critical" as const) : ("default" as const),
      sub: "open critical anomalies",
    },
    {
      label: "Warning",
      value: stats.openWarning,
      icon: AlertTriangle,
      tone: stats.openWarning > 0 ? ("warning" as const) : ("default" as const),
      sub: "open warnings",
    },
    {
      label: "Info",
      value: stats.openInfo,
      icon: Info,
      tone: "primary" as const,
      sub: "informational flags",
    },
    {
      label: "Clients affected",
      value: stats.clientsAffected,
      icon: Building2,
      tone: "default" as const,
      sub: "with open anomalies",
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
                (c.tone === "critical"
                  ? "bg-destructive/10 text-destructive"
                  : c.tone === "warning"
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
