import type {
  WorkItem,
  WorkStatus,
  WorkTask,
  WorkPriority,
} from "@/db/schema";

/** Minimal user shape passed to client components (avoid leaking password hashes etc.). */
export type WorkUser = {
  id: string;
  name: string;
  image: string | null;
  color: string | null;
};

/** Minimal org shape for selectors / display. */
export type WorkOrg = {
  id: string;
  name: string;
};

/** Minimal contact shape for the bill-to / linked-contact selector. */
export type WorkContact = {
  id: string;
  name: string;
  organizationId: string | null;
};

export type WorkTypeLite = {
  id: string;
  name: string;
  color: string | null;
  defaultBudgetMinutes: number | null;
};

/** A work item enriched with the few display fields the views need. */
export type WorkItemRow = WorkItem & {
  orgName: string | null;
  workTypeName: string | null;
  workTypeColor: string | null;
  taskTotal: number;
  taskDone: number;
};

export type BoardData = {
  statuses: WorkStatus[];
  items: WorkItemRow[];
  users: WorkUser[];
  orgs: WorkOrg[];
  workTypes: WorkTypeLite[];
};

export const PRIORITY_LABELS: Record<WorkPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_ORDER: Record<WorkPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export type { WorkItem, WorkStatus, WorkTask, WorkPriority };
