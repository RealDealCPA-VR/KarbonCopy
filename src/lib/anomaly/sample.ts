/**
 * Sample transaction generator — lets the anomaly radar be demoed end-to-end
 * before the live QuickBooks Desktop bridge exists. Deterministic-ish but seeded
 * with the org id so different clients produce different (stable) books.
 *
 * This is demo scaffolding only; real scans feed in NormalizedTxn[] from QB or a
 * parsed statement via `scanTransactions`.
 */
import type { NormalizedTxn } from "./rules";

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const VENDORS = [
  "Acme Office Supplies",
  "Pacific Power & Light",
  "Bluebird Marketing LLC",
  "Northgate Property Mgmt",
  "Sterling Legal Group",
  "CloudHost Inc",
];

const ACCOUNTS = [
  "Office Expense",
  "Utilities",
  "Advertising",
  "Rent",
  "Professional Fees",
  "Software & Subscriptions",
];

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

/**
 * Build a realistic-ish month of books for `orgId` that *intentionally* contains
 * one of each anomaly kind so a demo scan lights up the radar.
 */
export function generateSampleTxns(orgId: string): NormalizedTxn[] {
  const rnd = seeded(orgId || "demo");
  const txns: NormalizedTxn[] = [];

  // ~24 ordinary transactions
  for (let i = 0; i < 24; i++) {
    const vi = Math.floor(rnd() * VENDORS.length);
    const cents = 1500 + Math.floor(rnd() * 480_00); // $15–$4,815, non-round-ish
    txns.push({
      id: `${orgId}-t${i}`,
      date: daysAgo(Math.floor(rnd() * 30)),
      amountCents: cents + (cents % 100 === 0 ? 37 : 0),
      vendor: VENDORS[vi],
      account: ACCOUNTS[vi],
      memo: "Recurring expense",
      txnType: "Bill",
    });
  }

  // duplicate_payment: two identical payments 3 days apart
  txns.push({
    id: `${orgId}-dup1`,
    date: daysAgo(12),
    amountCents: 184_250,
    vendor: "Sterling Legal Group",
    account: "Professional Fees",
    memo: "Invoice #4471",
    txnType: "Bill Payment",
  });
  txns.push({
    id: `${orgId}-dup2`,
    date: daysAgo(9),
    amountCents: 184_250,
    vendor: "Sterling Legal Group",
    account: "Professional Fees",
    memo: "Invoice #4471 (resent)",
    txnType: "Bill Payment",
  });

  // round_dollar: exactly $10,000
  txns.push({
    id: `${orgId}-round1`,
    date: daysAgo(6),
    amountCents: 1_000_000,
    vendor: "Bluebird Marketing LLC",
    account: "Advertising",
    memo: "Q campaign",
    txnType: "Check",
  });

  // backdated: posted last month, entered now
  txns.push({
    id: `${orgId}-back1`,
    date: daysAgo(40),
    entryDate: daysAgo(2),
    amountCents: 62_900,
    vendor: "Northgate Property Mgmt",
    account: "Rent",
    memo: "Late entry",
    txnType: "Bill",
  });

  // uncategorized_spike: several txns parked in "Uncategorized Expense"
  for (let i = 0; i < 4; i++) {
    txns.push({
      id: `${orgId}-unc${i}`,
      date: daysAgo(3 + i),
      amountCents: 90_000 + i * 12_000,
      vendor: "CloudHost Inc",
      account: "Ask My Accountant",
      memo: "Needs coding",
      txnType: "Expense",
    });
  }

  return txns;
}

/**
 * A statement ending-balance config that won't reconcile against the generated
 * txns — drives the reconciliation_drift rule in demos.
 */
export function sampleReconciliationConfig(txns: NormalizedTxn[]) {
  const net = txns.reduce((a, t) => a - t.amountCents, 0);
  // introduce a deliberate $432.10 drift
  return { expectedEndingBalanceCents: net - 43_210 };
}
