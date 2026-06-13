"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMinutes, initials, colorForId } from "@/lib/utils";
import type { HeatmapData, HeatCell } from "./types";

/**
 * Color scale for workload: green (under capacity) → amber (near/at) → red (over).
 * ratio = assigned load minutes / weekly capacity minutes for that week.
 */
function cellStyle(cell: HeatCell): { background: string; color: string } {
  if (cell.capacityMinutes <= 0) {
    return { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" };
  }
  if (cell.loadMinutes === 0) {
    return { background: "hsl(var(--muted)/0.5)", color: "hsl(var(--muted-foreground))" };
  }
  const r = cell.ratio;
  // Hue from green (140) at r=0 down to red (0) at r>=1.25, easing toward amber mid-range.
  const clamped = Math.min(r, 1.25);
  const hue = 140 - (clamped / 1.25) * 140; // 140 -> 0
  // Saturate more as load increases; lightness mid so text stays legible.
  const sat = 55 + Math.min(clamped, 1) * 20;
  const light = r > 1 ? 42 : 46;
  const text = "white";
  return { background: `hsl(${hue} ${sat}% ${light}%)`, color: text };
}

function loadLabel(ratio: number): string {
  if (ratio === 0) return "Free";
  if (ratio <= 0.7) return "Light";
  if (ratio <= 1.0) return "Healthy";
  if (ratio <= 1.25) return "Tight";
  return "Overloaded";
}

export function CapacityHeatmap({ data }: { data: HeatmapData }) {
  if (data.rows.length === 0 || data.weeks.length === 0) {
    return (
      <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
        No staff with assigned work to chart.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            {/* header row */}
            <div
              className="grid items-end gap-1.5 pb-2"
              style={{ gridTemplateColumns: `180px repeat(${data.weeks.length}, minmax(0, 1fr))` }}
            >
              <div className="text-xs font-medium text-muted-foreground">Staff</div>
              {data.weeks.map((w) => (
                <div key={w.weekStart} className="text-center text-[11px] font-medium text-muted-foreground">
                  {w.label}
                </div>
              ))}
            </div>

            {/* staff rows */}
            <div className="space-y-1.5">
              {data.rows.map((row) => (
                <div
                  key={row.userId}
                  className="grid items-center gap-1.5"
                  style={{ gridTemplateColumns: `180px repeat(${data.weeks.length}, minmax(0, 1fr))` }}
                >
                  <div className="flex items-center gap-2 pr-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: row.color || colorForId(row.userId) }}
                    >
                      {initials(row.name)}
                    </span>
                    <span className="truncate text-sm font-medium">{row.name}</span>
                  </div>

                  {row.cells.map((cell) => {
                    const style = cellStyle(cell);
                    const pct = cell.capacityMinutes
                      ? Math.round(cell.ratio * 100)
                      : 0;
                    return (
                      <Tooltip key={cell.weekStart}>
                        <TooltipTrigger asChild>
                          <div
                            className="flex h-10 cursor-default items-center justify-center rounded-md text-[11px] font-semibold tabular-nums transition-transform hover:scale-[1.04]"
                            style={style}
                          >
                            {cell.loadMinutes > 0 ? `${pct}%` : ""}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="bg-popover text-popover-foreground">
                          <div className="text-xs">
                            <div className="font-medium">
                              {row.name} · {loadLabel(cell.ratio)}
                            </div>
                            <div className="text-muted-foreground">
                              {formatMinutes(cell.loadMinutes)} of {formatMinutes(cell.capacityMinutes)} ·{" "}
                              {cell.items} {cell.items === 1 ? "item" : "items"} due
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-xs text-muted-foreground">
          <span className="font-medium">Workload vs capacity:</span>
          {[
            { label: "Light", color: "hsl(120 60% 46%)" },
            { label: "Healthy", color: "hsl(70 65% 45%)" },
            { label: "Tight", color: "hsl(30 70% 44%)" },
            { label: "Overloaded", color: "hsl(0 72% 42%)" },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-muted" />
            No load
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
}
