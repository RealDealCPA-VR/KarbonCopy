/**
 * Chart color helpers. Recharts renders to SVG and does not read Tailwind classes,
 * so we pass explicit colors. We keep a palette that reads well on both light and
 * dark backgrounds, and resolve token-driven colors at render time on the client.
 */

export const CHART_PALETTE = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#ef4444", // red
  "#14b8a6", // teal
  "#f97316", // orange
  "#6366f1", // indigo
];

export function paletteAt(i: number): string {
  return CHART_PALETTE[i % CHART_PALETTE.length];
}

/** Map a work-status category to a sensible default color when none is set. */
export function categoryColor(category: string): string {
  switch (category) {
    case "todo":
      return "#94a3b8"; // slate
    case "in_progress":
      return "#3b82f6"; // blue
    case "waiting":
      return "#f59e0b"; // amber
    case "review":
      return "#8b5cf6"; // violet
    case "done":
      return "#22c55e"; // green
    default:
      return "#94a3b8";
  }
}

/** Read an HSL CSS token (e.g. "--muted-foreground") into an rgb-ish hsl() string for SVG. */
export function cssToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `hsl(${raw})` : fallback;
}
