/**
 * Typed helpers over the QuickBooks Desktop MCP server.
 *
 * Transport: stdio (child process). Tool surface confirmed from
 * `Quickbooks MCP Desktop/src/tools/*.ts`:
 *   - qb_customer_list  → { count, customers: [{ ListID, Name, FullName,
 *       CompanyName, Email, Phone, Balance, ... }] }
 *   - qb_invoice_list   → { count, invoices: [{ TxnID, RefNumber,
 *       CustomerRef: { ListID, FullName }, BalanceRemaining, ... }] }
 *
 * Both list tools support pagination (paginate/autoExhaust). We use
 * autoExhaust to pull the full set in one call (capped server-side).
 *
 * These helpers are reusable by other modules (e.g. the anomaly radar's
 * books-health checks can call qbListInvoices / qbCallTool directly).
 */
import "server-only";

import { callTool, listTools } from "./mcp-client";
import type { McpResult, McpTransportConfig, McpToolInfo } from "./mcp-client";

/** A QuickBooks customer, normalized toward KarbonCopy's needs. */
export type QbCustomer = {
  listId: string;
  /** Display name — prefers FullName (handles jobs), falls back to Name. */
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  /** Open AR balance in cents (QB returns dollars). */
  balanceCents?: number;
  isActive?: boolean;
};

export type QbInvoice = {
  txnId: string;
  refNumber?: string;
  customerListId?: string;
  customerName?: string;
  txnDate?: string;
  dueDate?: string;
  totalCents?: number;
  balanceRemainingCents?: number;
  isPaid?: boolean;
};

function dollarsToCents(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function normalizeCustomer(row: Record<string, unknown>): QbCustomer {
  const name =
    str(row.FullName) ?? str(row.Name) ?? str(row.CompanyName) ?? "(unnamed)";
  return {
    listId: String(row.ListID ?? ""),
    name,
    companyName: str(row.CompanyName),
    email: str(row.Email),
    phone: str(row.Phone),
    balanceCents: dollarsToCents(row.Balance),
    isActive: typeof row.IsActive === "boolean" ? row.IsActive : undefined,
  };
}

function normalizeInvoice(row: Record<string, unknown>): QbInvoice {
  const custRef = (row.CustomerRef ?? {}) as Record<string, unknown>;
  return {
    txnId: String(row.TxnID ?? ""),
    refNumber: str(row.RefNumber),
    customerListId: str(custRef.ListID),
    customerName: str(custRef.FullName) ?? str(custRef.Name),
    txnDate: str(row.TxnDate),
    dueDate: str(row.DueDate),
    totalCents: dollarsToCents(row.Subtotal ?? row.AppliedAmount ?? row.TotalAmount),
    balanceRemainingCents: dollarsToCents(row.BalanceRemaining),
    isPaid: typeof row.IsPaid === "boolean" ? row.IsPaid : undefined,
  };
}

/** Connect and list tools — surfaces whether this really is the QB server. */
export function qbPing(
  config: McpTransportConfig,
): Promise<McpResult<McpToolInfo[]>> {
  return listTools(config);
}

/** List customers (full set via server-side iterator exhaustion). */
export async function qbListCustomers(
  config: McpTransportConfig,
  opts: { nameFilter?: string; activeOnly?: boolean } = {},
): Promise<McpResult<QbCustomer[]>> {
  const args: Record<string, unknown> = { autoExhaust: true };
  if (opts.nameFilter) args.nameFilter = opts.nameFilter;
  if (opts.activeOnly === false) args.activeOnly = false;

  const res = await callTool(config, "qb_customer_list", args);
  if (!res.ok) return res;
  if (res.data.isError) {
    return { ok: false, error: res.data.text || "qb_customer_list returned an error" };
  }
  const body = (res.data.json ?? {}) as { customers?: unknown };
  const rows = Array.isArray(body.customers) ? body.customers : [];
  return {
    ok: true,
    data: rows.map((r) => normalizeCustomer(r as Record<string, unknown>)),
  };
}

/** List invoices. Pass `openOnly` for unpaid invoices (anomaly/AR uses). */
export async function qbListInvoices(
  config: McpTransportConfig,
  opts: { customerListId?: string; openOnly?: boolean } = {},
): Promise<McpResult<QbInvoice[]>> {
  const args: Record<string, unknown> = { autoExhaust: true };
  if (opts.customerListId) args.customerListId = opts.customerListId;
  if (opts.openOnly) args.paidStatus = "NotPaidOnly";

  const res = await callTool(config, "qb_invoice_list", args);
  if (!res.ok) return res;
  if (res.data.isError) {
    return { ok: false, error: res.data.text || "qb_invoice_list returned an error" };
  }
  const body = (res.data.json ?? {}) as { invoices?: unknown };
  const rows = Array.isArray(body.invoices) ? body.invoices : [];
  return {
    ok: true,
    data: rows.map((r) => normalizeInvoice(r as Record<string, unknown>)),
  };
}

/** Escape hatch for other modules: call any QB tool with raw args. */
export { callTool as qbCallTool };
