"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { ThroughputPoint } from "./types";

export function ThroughputChart({ data }: { data: ThroughputPoint[] }) {
  const total = data.reduce((s, d) => s + d.completed, 0);
  if (total === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        No completed work in this window yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ left: -16, right: 12, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="throughputFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          axisLine={{ stroke: "hsl(var(--border))" }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          width={36}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ stroke: "hsl(var(--border))" }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const v = payload[0].value as number;
            return (
              <div className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md">
                <div className="text-xs text-muted-foreground">Week of {label}</div>
                <div className="text-sm font-medium">
                  {v} completed
                </div>
              </div>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="completed"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#throughputFill)"
          dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
