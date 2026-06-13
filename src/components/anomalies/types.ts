import type { AnomalyStatus } from "@/db/schema";
import type { AnomalyKind, AnomalySeverity, AnomalySource } from "@/lib/anomaly/rules";

export type { AnomalyKind, AnomalySeverity, AnomalySource };

/** Row shape rendered by the radar (anomaly joined to its client). */
export type AnomalyItem = {
  id: string;
  organizationId: string | null;
  clientName: string | null;
  source: AnomalySource;
  kind: AnomalyKind | string;
  severity: AnomalySeverity;
  title: string;
  detail: string | null;
  amountCents: number | null;
  status: AnomalyStatus;
  detectedAt: string | number | Date;
  reviewedById: string | null;
  meta: Record<string, unknown> | null;
};

/** Anomalies grouped under one client for the cockpit. */
export type ClientGroup = {
  organizationId: string;
  clientName: string;
  items: AnomalyItem[];
  open: number;
  critical: number;
  warning: number;
  info: number;
};
