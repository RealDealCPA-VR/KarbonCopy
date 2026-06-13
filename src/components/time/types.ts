/** Shared client-side shapes for the Time & Budgets module. Dates are ms epochs. */

export type WorkItemOption = {
  id: string;
  title: string;
  organizationId: string | null;
  clientName: string | null;
};

export type TimeEntryRow = {
  id: string;
  workItemId: string | null;
  organizationId: string | null;
  description: string | null;
  minutes: number;
  billable: boolean;
  rateCents: number | null;
  date: number; // ms epoch (local midnight)
  approved: boolean;
  workTitle: string | null;
  clientName: string | null;
};

export type RunningTimer = {
  id: string;
  workItemId: string | null;
  description: string | null;
  billable: boolean;
  rateCents: number | null;
  minutes: number; // accumulated minutes before current run
  startedAt: number | null; // ms epoch
  workTitle: string | null;
  clientName: string | null;
};

export type BudgetRow = {
  id: string;
  title: string;
  organizationId: string | null;
  clientName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  budgetMinutes: number | null;
  budgetAmountCents: number | null;
  actualMinutes: number;
  billableMinutes: number;
  billableAmountCents: number;
  completed: boolean;
};

export type ApprovalEntry = {
  id: string;
  description: string | null;
  minutes: number;
  billable: boolean;
  rateCents: number | null;
  date: number;
  workTitle: string | null;
  clientName: string | null;
};

export type ApprovalGroup = {
  userId: string;
  userName: string;
  userImage: string | null;
  userColor: string | null;
  entries: ApprovalEntry[];
};
