/**
 * Pure-local document classifier + field extractor.
 *
 * Runs entirely on the firm's hardware against OCR'd text — no network, no
 * cloud. Cloud SaaS structurally cannot OCR SSN-bearing docs on-prem; this is
 * the local-first moat. A Claude pass (gated by aiEnabled()) may refine these
 * results in the server pipeline, but this heuristic is always the floor.
 */
import type { Classification, DocType } from "./types";

/** Keyword signal table. Each hit adds weight; more/strong hits → confidence. */
const SIGNALS: Record<Exclude<DocType, "unknown">, { kw: RegExp; w: number }[]> = {
  w2: [
    { kw: /\bw-?2\b/i, w: 3 },
    { kw: /wage and tax statement/i, w: 4 },
    { kw: /\bform\s*w-?2\b/i, w: 4 },
    { kw: /wages, tips, other comp/i, w: 3 },
    { kw: /social security wages/i, w: 2 },
    { kw: /medicare wages/i, w: 2 },
    { kw: /employer identification/i, w: 1 },
  ],
  "1099": [
    { kw: /\b1099-?(nec|misc|int|div|b|r|k|g|s)?\b/i, w: 3 },
    { kw: /nonemployee compensation/i, w: 4 },
    { kw: /miscellaneous information/i, w: 2 },
    { kw: /payer'?s? (tin|name)/i, w: 2 },
    { kw: /recipient'?s? (tin|name)/i, w: 2 },
    { kw: /interest income/i, w: 2 },
    { kw: /dividends/i, w: 1 },
  ],
  k1: [
    { kw: /schedule k-?1/i, w: 4 },
    { kw: /\bk-?1\b/i, w: 2 },
    { kw: /partner'?s? share of income/i, w: 4 },
    { kw: /shareholder'?s? share of income/i, w: 4 },
    { kw: /form 1065/i, w: 2 },
    { kw: /form 1120-?s/i, w: 2 },
    { kw: /beneficiary'?s? share/i, w: 2 },
  ],
  bank_stmt: [
    { kw: /statement period/i, w: 3 },
    { kw: /beginning balance/i, w: 3 },
    { kw: /ending balance/i, w: 3 },
    { kw: /account summary/i, w: 2 },
    { kw: /deposits and (other )?credits/i, w: 3 },
    { kw: /withdrawals and (other )?debits/i, w: 3 },
    { kw: /available balance/i, w: 2 },
    { kw: /routing number/i, w: 1 },
  ],
  "8879": [
    { kw: /\b8879\b/i, w: 4 },
    { kw: /e-?file signature authorization/i, w: 4 },
    { kw: /irs e-?file/i, w: 2 },
    { kw: /declaration of taxpayer/i, w: 2 },
    { kw: /ero'?s? (efin|signature)/i, w: 2 },
  ],
  id: [
    { kw: /driver'?s? license/i, w: 4 },
    { kw: /identification card/i, w: 3 },
    { kw: /\bpassport\b/i, w: 4 },
    { kw: /date of birth/i, w: 2 },
    { kw: /\bdob\b/i, w: 1 },
    { kw: /\bsex\b\s*[:m/f]/i, w: 1 },
    { kw: /class\s*[:c]/i, w: 1 },
  ],
};

/**
 * Classify OCR text into a DocType using weighted keyword density.
 * Returns `unknown` at low/zero signal.
 */
export function classifyText(text: string): Classification {
  const t = text || "";
  if (t.trim().length < 8) {
    return { docType: "unknown", confidence: 0, matched: [] };
  }

  let best: { docType: DocType; score: number; matched: string[] } = {
    docType: "unknown",
    score: 0,
    matched: [],
  };

  for (const [docType, signals] of Object.entries(SIGNALS) as [
    Exclude<DocType, "unknown">,
    { kw: RegExp; w: number }[],
  ][]) {
    let score = 0;
    const matched: string[] = [];
    for (const { kw, w } of signals) {
      const m = t.match(kw);
      if (m) {
        score += w;
        matched.push(m[0]);
      }
    }
    if (score > best.score) best = { docType, score, matched };
  }

  if (best.score === 0) return { docType: "unknown", confidence: 0, matched: [] };

  // Map raw score → confidence with diminishing returns. A score of ~7
  // (one strong + a couple supporting hits) lands around 0.8.
  const confidence = Math.min(0.97, 1 - Math.exp(-best.score / 4));
  return {
    docType: best.docType,
    confidence: Math.round(confidence * 100) / 100,
    matched: best.matched.slice(0, 6),
  };
}

/* ------------------------------------------------------------------ */
/* Lightweight, purely-local field extraction                          */
/* ------------------------------------------------------------------ */

const TAX_YEAR = /\b(?:tax year|for (?:calendar )?year)\s*:?\s*(20\d{2})\b/i;
const ANY_YEAR = /\b(20[0-2]\d)\b/;
const EIN = /\b(\d{2}-\d{7})\b/;
const MONEY = /\$\s?([\d,]+\.\d{2})/g;
const SSN_MASKED = /\b(?:xxx|\*{3})[- ]?(?:xx|\*{2})[- ]?(\d{4})\b/i;
const ACCT_TAIL = /(?:account|acct)[^\d]{0,12}(?:no\.?|number|#|ending in)?[^\d]{0,6}(\d{3,4})\b/i;

/**
 * Extract a small, safe set of fields from OCR text. We deliberately avoid
 * surfacing full SSNs — only last-4 if already masked on the doc.
 */
export function extractFields(text: string, docType: DocType): Record<string, unknown> {
  const t = text || "";
  const fields: Record<string, unknown> = {};

  const yr = t.match(TAX_YEAR)?.[1] ?? t.match(ANY_YEAR)?.[1];
  if (yr) fields.taxYear = yr;

  const ein = t.match(EIN)?.[1];
  if (ein) fields.ein = ein;

  const ssn4 = t.match(SSN_MASKED)?.[1];
  if (ssn4) fields.ssnLast4 = ssn4;

  // largest dollar amount on the page — a useful "headline number".
  const amounts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = MONEY.exec(t)) !== null) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) amounts.push(n);
  }
  MONEY.lastIndex = 0;
  if (amounts.length) {
    fields.maxAmount = Math.max(...amounts);
    fields.amountCount = amounts.length;
  }

  if (docType === "bank_stmt") {
    const acct = t.match(ACCT_TAIL)?.[1];
    if (acct) fields.accountTail = acct;
  }

  // first non-empty line is often the issuer/employer/bank name.
  const firstLine = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length >= 3 && l.length <= 80 && /[a-z]/i.test(l));
  if (firstLine) fields.headerLine = firstLine;

  return fields;
}

/**
 * Map a DocType to candidate document-request item labels. Used to auto-match
 * an extracted doc to an open request's outstanding item.
 */
export function docTypeLabelPatterns(docType: DocType): RegExp[] {
  switch (docType) {
    case "w2":
      return [/\bw-?2\b/i, /wage/i];
    case "1099":
      return [/\b1099\b/i, /nonemployee/i, /interest/i, /dividend/i];
    case "k1":
      return [/\bk-?1\b/i, /schedule k/i, /partner/i, /shareholder/i];
    case "bank_stmt":
      return [/bank/i, /statement/i, /account/i];
    case "8879":
      return [/8879/i, /e-?file/i, /signature authorization/i];
    case "id":
      return [/\bid\b/i, /driver/i, /license/i, /passport/i, /identification/i];
    default:
      return [];
  }
}
