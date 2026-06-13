"use client";

import * as React from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Sector } from "recharts";
import { categoryColor } from "./chart-theme";
import type { StatusSlice } from "./types";

export function StatusDonut({ data }: { data: StatusSlice[] }) {
  const [active, setActive] = React.useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        No open work to chart yet.
      </div>
    );
  }

  const colored = data.map((d) => ({
    ...d,
    fill: d.color && /^#/.test(d.color) ? d.color : categoryColor(d.category),
  }));

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative mx-auto h-[220px] w-[220px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={colored}
              dataKey="count"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={64}
              outerRadius={92}
              paddingAngle={2}
              stroke="hsl(var(--card))"
              strokeWidth={2}
              activeIndex={active ?? undefined}
              activeShape={(props: unknown) => {
                const p = props as React.ComponentProps<typeof Sector> & { outerRadius: number };
                return <Sector {...p} outerRadius={p.outerRadius + 6} />;
              }}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              {colored.map((d) => (
                <Cell key={d.id} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums">
            {active != null ? colored[active].count : total}
          </span>
          <span className="max-w-[7rem] truncate text-center text-xs text-muted-foreground">
            {active != null ? colored[active].name : "open items"}
          </span>
        </div>
      </div>

      <ul className="flex-1 space-y-1.5">
        {colored.map((d, i) => {
          const pct = total ? Math.round((d.count / total) * 100) : 0;
          return (
            <li
              key={d.id}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              className="flex items-center gap-2.5 rounded-md px-2 py-1 transition-colors hover:bg-accent"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.fill }} />
              <span className="flex-1 truncate text-sm">{d.name}</span>
              <span className="text-sm font-medium tabular-nums">{d.count}</span>
              <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
