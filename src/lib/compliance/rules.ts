/**
 * Bundled offline US tax / compliance calendar.
 *
 * A maintained, dependency-free ruleset of federal (and a handful of common
 * state) filing deadlines. Each rule knows which entity types it applies to and
 * can compute its due date (+ extended due date) from a tax year and the org's
 * fiscal-year-end (FYE, stored as "MM-DD" on organizations.fiscalYearEnd).
 *
 * This runs entirely on-prem — no network, no per-year subscription. Dates use
 * the standard IRS "Nth month / day after period end" conventions and apply the
 * weekend/holiday business-day bump. It is intentionally a *practical* calendar
 * (the dates a firm actually tracks), not an exhaustive 50-state matrix; states
 * are easy to extend by appending rules below.
 *
 *  ── Maintenance note ──────────────────────────────────────────────
 *  Most rules are FYE-relative (good for fiscal-year filers). A few federal
 *  individual/quarterly dates are fixed calendar dates (Apr 15, etc.) because
 *  that is how the IRS publishes them. When statutory dates shift (e.g. Emancipation
 *  Day), the business-day bump below approximates it; hard exceptions can be added
 *  to FIXED_OVERRIDES.
 */
import type { EntityType } from "@/db/schema";

/* ------------------------------------------------------------------ */
/* Date helpers (UTC-safe, no external deps)                          */
/* ------------------------------------------------------------------ */

/** Build a UTC date at midnight (avoids TZ drift when persisting timestamps). */
export function utcDate(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

/** Last day of a given 1-based month/year. */
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * Bump a date forward to the next business day if it lands on Sat/Sun or a
 * fixed federal holiday. (Approximation of the IRS "next business day" rule.)
 */
export function nextBusinessDay(d: Date): Date {
  let out = new Date(d.getTime());
  for (let i = 0; i < 6; i++) {
    const dow = out.getUTCDay();
    if (dow === 0) {
      out = addDaysUtc(out, 1);
      continue;
    }
    if (dow === 6) {
      out = addDaysUtc(out, 2);
      continue;
    }
    if (isFederalHoliday(out)) {
      out = addDaysUtc(out, 1);
      continue;
    }
    break;
  }
  return out;
}

export function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400_000);
}

export function addMonthsUtc(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const targetY = y + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const maxDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetY, targetM, Math.min(day, maxDay)));
}

/** Minimal fixed-date federal holiday check (New Year's, Independence Day, Christmas, Emancipation Day DC). */
function isFederalHoliday(d: Date): boolean {
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  // New Year's (Jan 1), Juneteenth (Jun 19), Independence (Jul 4),
  // Emancipation Day in DC (Apr 16 — pushes 1040 deadline), Christmas (Dec 25).
  return (
    (m === 1 && day === 1) ||
    (m === 4 && day === 16) ||
    (m === 6 && day === 19) ||
    (m === 7 && day === 4) ||
    (m === 12 && day === 25)
  );
}

/* ------------------------------------------------------------------ */
/* FYE parsing                                                        */
/* ------------------------------------------------------------------ */

export type Fye = { month: number; day: number };

/** Parse "MM-DD" (or "12-31") into {month, day}; defaults to Dec 31 (calendar year). */
export function parseFye(fye: string | null | undefined): Fye {
  if (fye) {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(fye.trim());
    if (m) {
      const month = Math.min(12, Math.max(1, parseInt(m[1], 10)));
      const day = Math.min(31, Math.max(1, parseInt(m[2], 10)));
      return { month, day };
    }
  }
  return { month: 12, day: 31 };
}

/** True for a standard calendar-year (Dec 31) filer. */
export function isCalendarYear(fye: Fye): boolean {
  return fye.month === 12 && fye.day === 31;
}

/**
 * The calendar year in which a tax period *ends*, given the tax year label.
 * For calendar-year filers the period ends in that same year. For fiscal-year
 * filers we treat the FYE that falls within the tax year as the period end.
 */
function periodEndYear(taxYear: number): number {
  return taxYear;
}

/* ------------------------------------------------------------------ */
/* Rule model                                                         */
/* ------------------------------------------------------------------ */

export type ComputeArgs = {
  taxYear: number;
  fye: Fye;
};

export type ComputedDeadline = {
  /** The base statutory due date (already business-day adjusted). */
  dueDate: Date;
  /** The extended due date if an extension applies (else null). */
  extendedDueDate: Date | null;
  /** The tax-period label, e.g. "2024" or "2024-Q1". Defaults to the tax year. */
  taxPeriod?: string;
};

export type ComplianceRule = {
  /** Stable identity used for idempotent upserts (org + ruleKey + taxPeriod). */
  key: string;
  /** Human label template; {year} is substituted with the period. */
  label: string;
  form: string;
  jurisdiction: string; // "federal" or a 2-letter state code
  entityTypes: EntityType[];
  /** Whether this rule fires once a year (annual) — used by the generator. */
  cadence: "annual" | "quarterly";
  /** Compute the due/extended dates for a given tax year + FYE. */
  compute: (args: ComputeArgs) => ComputedDeadline | ComputedDeadline[];
};

/* ------------------------------------------------------------------ */
/* Shared computations                                               */
/* ------------------------------------------------------------------ */

/**
 * "Nth month, fixed day after period end" — the core IRS pattern.
 * 1065/1120S = 15th day of the 3rd month after FYE.
 * 1120/1041  = 15th day of the 4th month after FYE.
 * 990        = 15th day of the 5th month after FYE.
 */
function dueNthMonthAfterFye(
  fye: Fye,
  taxYear: number,
  monthsAfter: number,
  day = 15,
): Date {
  const endYear = periodEndYear(taxYear);
  const periodEnd = utcDate(endYear, fye.month, Math.min(fye.day, lastDayOfMonth(endYear, fye.month)));
  // First day of the month that is `monthsAfter` months past the period-end month.
  const base = addMonthsUtc(utcDate(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, 1), monthsAfter);
  const due = utcDate(base.getUTCFullYear(), base.getUTCMonth() + 1, day);
  return nextBusinessDay(due);
}

/* ------------------------------------------------------------------ */
/* The bundled ruleset                                               */
/* ------------------------------------------------------------------ */

const C_CORP: EntityType[] = ["c_corp"];
const INDIVIDUAL: EntityType[] = ["individual", "sole_prop"];
const FIDUCIARY: EntityType[] = ["trust", "estate"];
const NONPROFIT: EntityType[] = ["nonprofit"];
const EMPLOYERS: EntityType[] = [
  "sole_prop", "partnership", "s_corp", "c_corp", "llc", "nonprofit", "trust", "estate",
];

export const RULES: ComplianceRule[] = [
  /* ---- Federal income-tax returns -------------------------------- */
  {
    key: "fed-1065",
    label: "{year} Form 1065 (Partnership Return)",
    form: "1065",
    jurisdiction: "federal",
    entityTypes: ["partnership", "llc"],
    cadence: "annual",
    compute: ({ taxYear, fye }) => ({
      dueDate: dueNthMonthAfterFye(fye, taxYear, 3),
      // 6-month extension via Form 7004
      extendedDueDate: dueNthMonthAfterFye(fye, taxYear, 9),
    }),
  },
  {
    key: "fed-1120s",
    label: "{year} Form 1120-S (S-Corp Return)",
    form: "1120S",
    jurisdiction: "federal",
    entityTypes: ["s_corp"],
    cadence: "annual",
    compute: ({ taxYear, fye }) => ({
      dueDate: dueNthMonthAfterFye(fye, taxYear, 3),
      extendedDueDate: dueNthMonthAfterFye(fye, taxYear, 9),
    }),
  },
  {
    key: "fed-1120",
    label: "{year} Form 1120 (C-Corp Return)",
    form: "1120",
    jurisdiction: "federal",
    entityTypes: C_CORP,
    cadence: "annual",
    compute: ({ taxYear, fye }) => ({
      dueDate: dueNthMonthAfterFye(fye, taxYear, 4),
      extendedDueDate: dueNthMonthAfterFye(fye, taxYear, 10),
    }),
  },
  {
    key: "fed-1040",
    label: "{year} Form 1040 (Individual Return)",
    form: "1040",
    jurisdiction: "federal",
    entityTypes: INDIVIDUAL,
    cadence: "annual",
    // Individuals are (effectively) calendar-year: Apr 15, extension Oct 15.
    compute: ({ taxYear }) => ({
      dueDate: nextBusinessDay(utcDate(taxYear + 1, 4, 15)),
      extendedDueDate: nextBusinessDay(utcDate(taxYear + 1, 10, 15)),
    }),
  },
  {
    key: "fed-1041",
    label: "{year} Form 1041 (Fiduciary Return)",
    form: "1041",
    jurisdiction: "federal",
    entityTypes: FIDUCIARY,
    cadence: "annual",
    compute: ({ taxYear, fye }) => ({
      dueDate: dueNthMonthAfterFye(fye, taxYear, 4),
      // 5.5-month extension → 9.5 months; approximate to the 15th of the 9th+ month
      extendedDueDate: dueNthMonthAfterFye(fye, taxYear, 9, 30),
    }),
  },
  {
    key: "fed-990",
    label: "{year} Form 990 (Exempt-Org Return)",
    form: "990",
    jurisdiction: "federal",
    entityTypes: NONPROFIT,
    cadence: "annual",
    compute: ({ taxYear, fye }) => ({
      dueDate: dueNthMonthAfterFye(fye, taxYear, 5),
      extendedDueDate: dueNthMonthAfterFye(fye, taxYear, 11),
    }),
  },

  /* ---- Federal payroll / information returns --------------------- */
  {
    key: "fed-941",
    label: "{year} Form 941 (Quarterly Payroll)",
    form: "941",
    jurisdiction: "federal",
    entityTypes: EMPLOYERS,
    cadence: "quarterly",
    // Last day of the month following each calendar quarter.
    compute: ({ taxYear }) => [
      { dueDate: nextBusinessDay(utcDate(taxYear, 4, 30)), extendedDueDate: null, taxPeriod: `${taxYear}-Q1` },
      { dueDate: nextBusinessDay(utcDate(taxYear, 7, 31)), extendedDueDate: null, taxPeriod: `${taxYear}-Q2` },
      { dueDate: nextBusinessDay(utcDate(taxYear, 10, 31)), extendedDueDate: null, taxPeriod: `${taxYear}-Q3` },
      { dueDate: nextBusinessDay(utcDate(taxYear + 1, 1, 31)), extendedDueDate: null, taxPeriod: `${taxYear}-Q4` },
    ],
  },
  {
    key: "fed-940",
    label: "{year} Form 940 (FUTA Annual)",
    form: "940",
    jurisdiction: "federal",
    entityTypes: EMPLOYERS,
    cadence: "annual",
    compute: ({ taxYear }) => ({
      dueDate: nextBusinessDay(utcDate(taxYear + 1, 1, 31)),
      extendedDueDate: null,
    }),
  },
  {
    key: "fed-w2-1099",
    label: "{year} W-2 / 1099-NEC Filing",
    form: "W-2/1099",
    jurisdiction: "federal",
    entityTypes: EMPLOYERS,
    cadence: "annual",
    compute: ({ taxYear }) => ({
      dueDate: nextBusinessDay(utcDate(taxYear + 1, 1, 31)),
      extendedDueDate: null,
    }),
  },

  /* ---- Federal estimated tax (individuals / pass-throughs) ------- */
  {
    key: "fed-1040es",
    label: "{year} Form 1040-ES (Estimated Tax)",
    form: "1040-ES",
    jurisdiction: "federal",
    entityTypes: INDIVIDUAL,
    cadence: "quarterly",
    compute: ({ taxYear }) => [
      { dueDate: nextBusinessDay(utcDate(taxYear, 4, 15)), extendedDueDate: null, taxPeriod: `${taxYear}-Q1` },
      { dueDate: nextBusinessDay(utcDate(taxYear, 6, 15)), extendedDueDate: null, taxPeriod: `${taxYear}-Q2` },
      { dueDate: nextBusinessDay(utcDate(taxYear, 9, 15)), extendedDueDate: null, taxPeriod: `${taxYear}-Q3` },
      { dueDate: nextBusinessDay(utcDate(taxYear + 1, 1, 15)), extendedDueDate: null, taxPeriod: `${taxYear}-Q4` },
    ],
  },
  {
    key: "fed-1120-est",
    label: "{year} Form 1120-W (Corp Estimated Tax)",
    form: "1120-W",
    jurisdiction: "federal",
    entityTypes: C_CORP,
    cadence: "quarterly",
    // 15th day of 4th, 6th, 9th, 12th month of the tax year (calendar-year approx).
    compute: ({ taxYear }) => [
      { dueDate: nextBusinessDay(utcDate(taxYear, 4, 15)), extendedDueDate: null, taxPeriod: `${taxYear}-Q1` },
      { dueDate: nextBusinessDay(utcDate(taxYear, 6, 15)), extendedDueDate: null, taxPeriod: `${taxYear}-Q2` },
      { dueDate: nextBusinessDay(utcDate(taxYear, 9, 15)), extendedDueDate: null, taxPeriod: `${taxYear}-Q3` },
      { dueDate: nextBusinessDay(utcDate(taxYear, 12, 15)), extendedDueDate: null, taxPeriod: `${taxYear}-Q4` },
    ],
  },

  /* ---- A few common state income-tax returns -------------------- */
  // California
  {
    key: "ca-3522-llc",
    label: "{year} CA LLC Annual Tax (FTB 3522)",
    form: "CA-3522",
    jurisdiction: "CA",
    entityTypes: ["llc"],
    cadence: "annual",
    // 15th day of the 4th month of the tax year.
    compute: ({ taxYear }) => ({
      dueDate: nextBusinessDay(utcDate(taxYear, 4, 15)),
      extendedDueDate: null,
    }),
  },
  {
    key: "ca-100s",
    label: "{year} CA Form 100S (S-Corp)",
    form: "CA-100S",
    jurisdiction: "CA",
    entityTypes: ["s_corp"],
    cadence: "annual",
    compute: ({ taxYear, fye }) => ({
      dueDate: dueNthMonthAfterFye(fye, taxYear, 3),
      extendedDueDate: dueNthMonthAfterFye(fye, taxYear, 9),
    }),
  },
  // New York
  {
    key: "ny-ct3",
    label: "{year} NY Form CT-3 (Corp Franchise)",
    form: "NY-CT-3",
    jurisdiction: "NY",
    entityTypes: ["c_corp", "s_corp"],
    cadence: "annual",
    compute: ({ taxYear, fye }) => ({
      dueDate: dueNthMonthAfterFye(fye, taxYear, 3, 15),
      extendedDueDate: dueNthMonthAfterFye(fye, taxYear, 9, 15),
    }),
  },
  {
    key: "ny-it201",
    label: "{year} NY Form IT-201 (Resident Individual)",
    form: "NY-IT-201",
    jurisdiction: "NY",
    entityTypes: INDIVIDUAL,
    cadence: "annual",
    compute: ({ taxYear }) => ({
      dueDate: nextBusinessDay(utcDate(taxYear + 1, 4, 15)),
      extendedDueDate: nextBusinessDay(utcDate(taxYear + 1, 10, 15)),
    }),
  },
  // Texas (no income tax — franchise/margin report, very common)
  {
    key: "tx-franchise",
    label: "{year} TX Franchise (Margin) Report",
    form: "TX-05-158",
    jurisdiction: "TX",
    entityTypes: ["c_corp", "s_corp", "llc", "partnership"],
    cadence: "annual",
    // Texas franchise report is due May 15.
    compute: ({ taxYear }) => ({
      dueDate: nextBusinessDay(utcDate(taxYear + 1, 5, 15)),
      extendedDueDate: nextBusinessDay(utcDate(taxYear + 1, 11, 15)),
    }),
  },
];

/* ------------------------------------------------------------------ */
/* Lookups                                                           */
/* ------------------------------------------------------------------ */

export const ALL_JURISDICTIONS = Array.from(new Set(RULES.map((r) => r.jurisdiction))).sort(
  (a, b) => (a === "federal" ? -1 : b === "federal" ? 1 : a.localeCompare(b)),
);

/** Rules that apply to a given entity type (optionally filtered to jurisdictions). */
export function rulesForEntity(
  entityType: EntityType,
  jurisdictions?: string[],
): ComplianceRule[] {
  return RULES.filter(
    (r) =>
      r.entityTypes.includes(entityType) &&
      (!jurisdictions || jurisdictions.includes(r.jurisdiction)),
  );
}

export function ruleByKey(key: string): ComplianceRule | undefined {
  return RULES.find((r) => r.key === key);
}

/** Substitute {year} (and {period}) placeholders in a rule label. */
export function renderLabel(rule: ComplianceRule, taxPeriod: string): string {
  return rule.label.replace(/\{year\}/g, taxPeriod).replace(/\{period\}/g, taxPeriod);
}
