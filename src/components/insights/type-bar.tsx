"use client";

import * as React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";
import { paletteAt } from "./chart-theme";
import { formatMoneyCents } from "@/lib/utils";
import type { TypeBar as TypeBarRow } from "./types";

export function TypeBar({ data }: { data: TypeBarRow[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        No work types to chart yet.
      </div>
    );
  }

  const rows = data.map((d, i) => ({
    ...d,
    fill: d.color && /^#/.test(d.color) ? d.color : paletteAt(i),
    budget: d.budgetCents / 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 42)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          axisLine={{ stroke: "hsl(var(--border))" }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as (typeof rows)[number];
            return (
              <div className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md">
                <div className="text-sm font-medium">{r.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {r.count} {r.count === 1 ? "item" : "items"} · {formatMoneyCents(r.budgetCents)} budget
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={28}>
          {rows.map((r) => (
            <Cell key={r.id} fill={r.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
