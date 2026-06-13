import type { ExtractionStatus } from "@/db/schema";
import type { DocType } from "@/lib/ocr";

/** A row in the intake review queue (joined for display). */
export type IntakeItem = {
  id: string;
  sourcePath: string;
  fileName: string;
  docType: DocType | null;
  confidence: number | null;
  status: ExtractionStatus;
  extractedFields: Record<string, unknown> | null;
  organizationId: string | null;
  clientName: string | null;
  matchedRequestId: string | null;
  matchedRequestTitle: string | null;
  engine: string | null;
  error: string | null;
  createdAt: string | number | Date;
  processedAt: string | number | Date | null;
};

/** An open document request, with its outstanding items, for the match picker. */
export type OpenRequest = {
  id: string;
  title: string;
  organizationId: string | null;
  items: Array<{ label: string; fulfilled: boolean }>;
};

/** Realtime payload broadcast by the OCR pipeline on the "extraction" channel. */
export type ExtractionPayload = {
  id: string;
  status?: ExtractionStatus;
  docType?: DocType;
  confidence?: number;
  fileName?: string;
  sourcePath?: string;
  organizationId?: string | null;
  matchedRequestId?: string | null;
};
