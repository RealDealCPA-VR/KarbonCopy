/**
 * Shared types for the on-prem document-understanding pipeline.
 *
 * These are framework-agnostic (no server-only imports) so both the server
 * pipeline and client UI can share the same vocabulary.
 */

/** Document classes we recognise. `unknown` = OCR'd but unclassified. */
export type DocType =
  | "w2"
  | "1099"
  | "k1"
  | "bank_stmt"
  | "8879"
  | "id"
  | "unknown";

export const DOC_TYPES: DocType[] = [
  "w2",
  "1099",
  "k1",
  "bank_stmt",
  "8879",
  "id",
  "unknown",
];

/** Human labels for each docType (used in the UI + request matching). */
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  w2: "W-2 (Wages)",
  "1099": "1099",
  k1: "Schedule K-1",
  bank_stmt: "Bank statement",
  "8879": "Form 8879 (e-file authorization)",
  id: "Photo ID",
  unknown: "Unclassified",
};

/** Result of the local heuristic classifier. */
export type Classification = {
  docType: DocType;
  /** 0..1 — heuristic confidence from keyword density. */
  confidence: number;
  /** keyword hits that drove the decision (for explainability). */
  matched: string[];
};
