import type { FileEventStatus, FileRuleEvent } from "@/db/schema";

export type Severity = "info" | "success" | "warning";

/** Shape returned by /api/alerts and rendered in the feed/audit log. */
export type AlertItem = {
  id: string;
  event: FileRuleEvent;
  filePath: string;
  fileName: string;
  sizeBytes: number | null;
  status: FileEventStatus;
  organizationId: string | null;
  workItemId: string | null;
  acknowledgedById: string | null;
  acknowledgedAt: string | number | Date | null;
  detectedAt: string | number | Date;
  clientName: string | null;
  ruleName: string | null;
  severity: Severity | null;
  /** present only when delivered over the realtime "file_event" channel */
  message?: string;
  /** flag used purely for the entrance highlight animation */
  isLive?: boolean;
};

/** Payload broadcast by the watcher over the "file_event" socket channel. */
export type FileEventPayload = {
  id: string;
  event: FileRuleEvent;
  filePath: string;
  fileName: string;
  sizeBytes?: number | null;
  status?: FileEventStatus;
  organizationId?: string | null;
  workItemId?: string | null;
  detectedAt?: string | number | Date;
  message?: string;
  severity?: Severity;
  clientName?: string | null;
};
