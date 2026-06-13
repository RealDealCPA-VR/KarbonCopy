/** Shared serializable types passed from the Insights server page to client components. */

export type Period = "month" | "last30" | "quarter";

export const PERIOD_LABELS: Record<Period, string> = {
  month: "This month",
  last30: "Last 30 days",
  quarter: "This quarter",
};

export function isPeriod(v: string | undefined | null): v is Period {
  return v === "month" || v === "last30" || v === "quarter";
}

export type Kpi = {
  openWork: number;
  overdue: number;
  completedThisPeriod: number;
  wipValueCents: number;
  billableMinutes: number;
  realizationPct: number | null; // billable / total logged, null if no time
};

export type StatusSlice = {
  id: string;
  name: string;
  category: string;
  color: string;
  count: number;
};

export type TypeBar = {
  id: string;
  name: string;
  color: string;
  count: number;
  budgetCents: number;
};

export type ThroughputPoint = {
  weekStart: string; // ISO date for the Monday of the week
  label: string; // e.g. "May 5"
  completed: number;
};

export type HeatCell = {
  weekStart: string;
  loadMinutes: number;
  capacityMinutes: number;
  ratio: number; // load / capacity
  items: number;
};

export type HeatRow = {
  userId: string;
  name: string;
  image: string | null;
  color: string | null;
  capacityMinutes: number;
  cells: HeatCell[];
};

export type HeatmapData = {
  weeks: { weekStart: string; label: string }[];
  rows: HeatRow[];
};

export type StaffRow = {
  userId: string;
  name: string;
  image: string | null;
  color: string | null;
  open: number;
  overdue: number;
  completedThisPeriod: number;
  loggedMinutes: number;
  capacityMinutes: number;
  utilizationPct: number | null;
};

export type ClientRow = {
  orgId: string;
  name: string;
  openWork: number;
  wipValueCents: number;
  loggedMinutes: number;
  lastActivityAt: number | null; // unix ms
};
