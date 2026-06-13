/**
 * Books-health anomaly radar — pure detection rules.
 *
 * These functions are deliberately framework-free and side-effect-free: they take a
 * list of normalized transactions and return *candidates*. Persistence, dedupe and
 * notification all happen in `scan.ts`. This keeps the rules trivially unit-testable
 * and lets the QuickBooks integration agent (or a statement parser) feed in any
 * transaction list — there is no coupling to QB, MCP, or the DB here.
 */

export type AnomalyKind =
  | "duplicate_payment"
  | "round_dollar"
  | "backdated"
  | "uncategorized_spike"
  | "reconciliation_drift";

export type AnomalySeverity = "info" | "warning" | "critical";

export type AnomalySource = "quickbooks" | "statement" | "manual";

/**
 * The normalized transaction shape the radar scans over. This is the contract the
 * QuickBooks integration (or a parsed-statement adapter) must produce. Everything
 * except `amountCents` is optional so partial feeds still yield useful signal.
 *
 * Amounts are integer cents. A *spend / debit* is a positive number here (money
 * leaving the books); deposits/credits may be supplied as negatives — rules that
 * care about direction document their own handling.
 */
export type NormalizedTxn = {
  /** Stable id from the source system (e.g. QB TxnID). Used to build dedupe signatures. */
  id?: string;
  /** Accounting/post date — when the transaction hits the books. ISO string or Date. */
  date: string | Date;
  /** Date the entry was actually created/entered, if the source tracks it (backdating). */
  entryDate?: string | Date | null;
  /** Integer cents. Positive = money out (payment/expense). */
  amountCents: number;
  /** Vendor / payee name. */
  vendor?: string | null;
  /** GL / chart-of-accounts account the txn is booked to. */
  account?: string | null;
  /** Memo / description line. */
  memo?: string | null;
  /** Document/reference number (check no., bill no.). */
  ref?: string | null;
  /** Free-form transaction type from the source (Check, Bill, Deposit, …). */
  txnType?: string | null;
};

/** A single candidate finding produced by a rule (not yet persisted). */
export type AnomalyCandidate = {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  title: string;
  detail: string;
  /** Representative amount for the finding, in cents (absolute). */
  amountCents: number | null;
  /**
   * Structured metadata. MUST contain a stable `signature` so `scan.ts` can dedupe
   * the same finding across repeated scans. Also carries the contributing txn ids.
   */
  meta: {
    /** Stable, deterministic key identifying *this specific finding*. */
    signature: string;
    /** Source txn ids (or synthesized keys) that triggered the finding. */
    txnIds?: string[];
    [k: string]: unknown;
  };
};

/** Tunable thresholds for the rules. Sensible defaults; override per-scan if needed. */
export type RuleConfig = {
  /** Window (days) within which same-vendor/same-amount payments count as duplicates. */
  duplicateWindowDays: number;
  /** Amounts at or above this (cents) that are exactly round are flagged. */
  roundDollarMinCents: number;
  /** How many days the post date must lead the entry date to be "backdated". */
  backdateThresholdDays: number;
  /** Critical-backdating threshold (days) — likely period manipulation. */
  backdateCriticalDays: number;
  /** Min spend (cents) booked to an uncategorized account before flagging a spike. */
  uncategorizedSpikeMinCents: number;
  /** Min txn count to an uncategorized account before flagging a spike. */
  uncategorizedSpikeMinCount: number;
  /** Reconciliation: expected ending balance (cents), if known, to compare against. */
  expectedEndingBalanceCents?: number | null;
  /** Reconciliation: drift (cents) above which a mismatch is flagged. */
  reconciliationToleranceCents: number;
};

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  duplicateWindowDays: 14,
  roundDollarMinCents: 100_000, // $1,000
  backdateThresholdDays: 7,
  backdateCriticalDays: 30,
  uncategorizedSpikeMinCents: 250_000, // $2,500
  uncategorizedSpikeMinCount: 3,
  expectedEndingBalanceCents: null,
  reconciliationToleranceCents: 100, // $1.00
};

/** Account names that signal "not categorized yet". */
const UNCATEGORIZED_ACCOUNTS = [
  "uncategorized",
  "ask my accountant",
  "ask accountant",
  "suspense",
  "misc",
  "miscellaneous",
];

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayDiff(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

function signedDayDiff(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 86_400_000;
}

function normVendor(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmt(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function txnKey(t: NormalizedTxn, idx: number): string {
  if (t.id) return t.id;
  const d = toDate(t.date);
  return `synthetic:${idx}:${d ? isoDay(d) : "nodate"}:${t.amountCents}:${normVendor(t.vendor)}`;
}

/* ------------------------------------------------------------------ */
/* Rule: duplicate_payment                                            */
/* ------------------------------------------------------------------ */

/**
 * Same vendor + same (absolute) amount booked within `duplicateWindowDays`.
 * Classic double-paid-bill detector. Critical when 3+ copies cluster.
 */
export function detectDuplicatePayments(
  txns: NormalizedTxn[],
  cfg: RuleConfig = DEFAULT_RULE_CONFIG,
): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];

  // Only consider money-out with a vendor and a date.
  const payments = txns
    .map((t, i) => ({ t, key: txnKey(t, i), date: toDate(t.date) }))
    .filter((x) => x.date && x.t.amountCents > 0 && normVendor(x.t.vendor));

  // group by vendor + amount
  const groups = new Map<string, typeof payments>();
  for (const p of payments) {
    const g = `${normVendor(p.t.vendor)}|${p.t.amountCents}`;
    const arr = groups.get(g) ?? [];
    arr.push(p);
    groups.set(g, arr);
  }

  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.date!.getTime() - b.date!.getTime());

    // sliding cluster of txns within the window of the cluster anchor
    let clusterStart = 0;
    for (let i = 1; i <= arr.length; i++) {
      const withinWindow =
        i < arr.length && dayDiff(arr[i].date!, arr[clusterStart].date!) <= cfg.duplicateWindowDays;
      if (withinWindow) continue;

      const cluster = arr.slice(clusterStart, i);
      if (cluster.length >= 2) {
        const vendor = cluster[0].t.vendor!.trim();
        const amount = cluster[0].t.amountCents;
        const ids = cluster.map((c) => c.key).sort();
        const days = cluster.map((c) => isoDay(c.date!));
        out.push({
          kind: "duplicate_payment",
          severity: cluster.length >= 3 ? "critical" : "critical",
          title: `Possible duplicate payment to ${vendor}`,
          detail:
            `${cluster.length} payments of ${fmt(amount)} to ${vendor} within ` +
            `${cfg.duplicateWindowDays} days (${days.join(", ")}). Likely a double-paid bill.`,
          amountCents: amount,
          meta: {
            signature: `duplicate_payment:${normVendor(vendor)}:${amount}:${days.join(",")}`,
            txnIds: ids,
            vendor,
            count: cluster.length,
            dates: days,
          },
        });
      }
      clusterStart = i;
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Rule: round_dollar                                                 */
/* ------------------------------------------------------------------ */

/**
 * Large, suspiciously round amounts (e.g. exactly $5,000.00). Real invoices rarely
 * land on round hundreds; round large amounts are a soft signal for estimates booked
 * as actuals, fraud, or plugs. Severity scales with how "round" and how large.
 */
export function detectRoundDollar(
  txns: NormalizedTxn[],
  cfg: RuleConfig = DEFAULT_RULE_CONFIG,
): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];

  txns.forEach((t, i) => {
    const amt = Math.abs(t.amountCents);
    if (amt < cfg.roundDollarMinCents) return;
    if (amt % 100 !== 0) return; // not even whole dollars → skip

    const dollars = amt / 100;
    // "roundness": divisible by 1000 is more suspicious than by 100.
    const roundTo =
      dollars % 10_000 === 0 ? 10_000 : dollars % 1_000 === 0 ? 1_000 : dollars % 100 === 0 ? 100 : 0;
    if (roundTo < 100) return;

    const d = toDate(t.date);
    const sev: AnomalySeverity = roundTo >= 10_000 ? "warning" : "info";
    const vendor = t.vendor?.trim();
    out.push({
      kind: "round_dollar",
      severity: sev,
      title: `Round-dollar amount ${fmt(amt)}${vendor ? ` — ${vendor}` : ""}`,
      detail:
        `Transaction for exactly ${fmt(amt)}${vendor ? ` to ${vendor}` : ""}` +
        `${t.account ? ` (${t.account})` : ""}. Round amounts of this size are uncommon for ` +
        `real invoices and may be an estimate, accrual plug, or manual entry.`,
      amountCents: amt,
      meta: {
        signature: `round_dollar:${txnKey(t, i)}:${amt}`,
        txnIds: [txnKey(t, i)],
        vendor: vendor ?? null,
        account: t.account ?? null,
        date: d ? isoDay(d) : null,
      },
    });
  });

  return out;
}

/* ------------------------------------------------------------------ */
/* Rule: backdated                                                    */
/* ------------------------------------------------------------------ */

/**
 * Entry created well *after* the post/accounting date — i.e. the books were edited
 * in a prior (possibly closed) period. Post date << entry date by more than the
 * threshold. Strong signal for period manipulation when it crosses month/quarter.
 */
export function detectBackdated(
  txns: NormalizedTxn[],
  cfg: RuleConfig = DEFAULT_RULE_CONFIG,
): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];

  txns.forEach((t, i) => {
    const post = toDate(t.date);
    const entry = toDate(t.entryDate);
    if (!post || !entry) return;

    // backdated = entry happened AFTER the post date (entry leads post)
    const lag = signedDayDiff(entry, post); // positive => entered after the fact
    if (lag < cfg.backdateThresholdDays) return;

    const crossesMonth = post.getMonth() !== entry.getMonth() || post.getFullYear() !== entry.getFullYear();
    const sev: AnomalySeverity =
      lag >= cfg.backdateCriticalDays || crossesMonth ? "critical" : "warning";
    const vendor = t.vendor?.trim();

    out.push({
      kind: "backdated",
      severity: sev,
      title: `Backdated entry (${Math.round(lag)} days)${vendor ? ` — ${vendor}` : ""}`,
      detail:
        `Posted ${isoDay(post)} but entered ${isoDay(entry)} — ${Math.round(lag)} days later` +
        `${crossesMonth ? ", crossing a period boundary" : ""}. ` +
        `Edits to a prior period can distort closed financials.`,
      amountCents: Math.abs(t.amountCents) || null,
      meta: {
        signature: `backdated:${txnKey(t, i)}:${isoDay(post)}:${isoDay(entry)}`,
        txnIds: [txnKey(t, i)],
        postDate: isoDay(post),
        entryDate: isoDay(entry),
        lagDays: Math.round(lag),
        crossesPeriod: crossesMonth,
      },
    });
  });

  return out;
}

/* ------------------------------------------------------------------ */
/* Rule: uncategorized_spike                                          */
/* ------------------------------------------------------------------ */

/**
 * Aggregate signal: too much money / too many transactions parked in an
 * "uncategorized" style account. One finding per offending account.
 */
export function detectUncategorizedSpike(
  txns: NormalizedTxn[],
  cfg: RuleConfig = DEFAULT_RULE_CONFIG,
): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];

  const buckets = new Map<
    string,
    { account: string; totalCents: number; ids: string[] }
  >();

  txns.forEach((t, i) => {
    const acct = (t.account ?? "").trim();
    if (!acct) return;
    const low = acct.toLowerCase();
    if (!UNCATEGORIZED_ACCOUNTS.some((u) => low.includes(u))) return;
    const b = buckets.get(low) ?? { account: acct, totalCents: 0, ids: [] };
    b.totalCents += Math.abs(t.amountCents);
    b.ids.push(txnKey(t, i));
    buckets.set(low, b);
  });

  for (const [low, b] of buckets) {
    const overAmount = b.totalCents >= cfg.uncategorizedSpikeMinCents;
    const overCount = b.ids.length >= cfg.uncategorizedSpikeMinCount;
    if (!overAmount && !overCount) continue;

    const sev: AnomalySeverity =
      b.totalCents >= cfg.uncategorizedSpikeMinCents * 4 ? "warning" : "info";

    out.push({
      kind: "uncategorized_spike",
      severity: sev,
      title: `${b.ids.length} uncategorized txns in “${b.account}” (${fmt(b.totalCents)})`,
      detail:
        `${b.ids.length} transactions totaling ${fmt(b.totalCents)} are sitting in ` +
        `“${b.account}”. These need to be coded to the correct accounts before close.`,
      amountCents: b.totalCents,
      meta: {
        signature: `uncategorized_spike:${low}`,
        txnIds: b.ids.sort(),
        account: b.account,
        count: b.ids.length,
      },
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Rule: reconciliation_drift                                         */
/* ------------------------------------------------------------------ */

/**
 * Sum-mismatch check. If the caller supplies an `expectedEndingBalanceCents`
 * (e.g. from a parsed bank statement), compare it to the net of the scanned
 * transactions and flag drift beyond tolerance.
 *
 * Net is computed as deposits (negative amounts) minus spend (positive amounts),
 * i.e. the change the txns *should* have produced in the balance.
 */
export function detectReconciliationDrift(
  txns: NormalizedTxn[],
  cfg: RuleConfig = DEFAULT_RULE_CONFIG,
): AnomalyCandidate[] {
  if (cfg.expectedEndingBalanceCents == null) return [];

  // net change to balance: deposits add, spend subtracts
  const net = txns.reduce((acc, t) => acc - t.amountCents, 0);
  const drift = cfg.expectedEndingBalanceCents - net;
  if (Math.abs(drift) <= cfg.reconciliationToleranceCents) return [];

  const sev: AnomalySeverity = Math.abs(drift) >= 10_000 ? "critical" : "warning";

  return [
    {
      kind: "reconciliation_drift",
      severity: sev,
      title: `Reconciliation drift of ${fmt(drift)}`,
      detail:
        `Statement ending balance change is ${fmt(cfg.expectedEndingBalanceCents)} but the ` +
        `scanned transactions net to ${fmt(net)} — a ${fmt(drift)} mismatch ` +
        `(${drift > 0 ? "missing entries" : "extra entries"} in the books).`,
      amountCents: Math.abs(drift),
      meta: {
        signature: `reconciliation_drift:${cfg.expectedEndingBalanceCents}:${net}`,
        expectedCents: cfg.expectedEndingBalanceCents,
        netCents: net,
        driftCents: drift,
        txnCount: txns.length,
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Orchestrator                                                       */
/* ------------------------------------------------------------------ */

export const ALL_RULES = [
  detectDuplicatePayments,
  detectRoundDollar,
  detectBackdated,
  detectUncategorizedSpike,
  detectReconciliationDrift,
] as const;

/** Run every rule and return the flattened candidate list. Pure. */
export function runAllRules(
  txns: NormalizedTxn[],
  cfg: RuleConfig = DEFAULT_RULE_CONFIG,
): AnomalyCandidate[] {
  return ALL_RULES.flatMap((rule) => rule(txns, cfg));
}
