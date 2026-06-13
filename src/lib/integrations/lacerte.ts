/**
 * Typed helpers over the Lacerte MCP server.
 *
 * Transport: stdio (the C# `LacertMCP.Server.exe` speaks JSON-RPC/stdio via
 * the .NET MCP SDK — see LacertMCP/CLAUDE.md "Transport"). It runs in
 * simulation mode off-Windows and live mode on Windows with LACERTE_LIVE=1.
 *
 * Envelope difference vs. QuickBooks: every Lacerte tool wraps its payload in
 * `{ success, result: <payload>, cid }` (WrapToolHandler.Run). So
 * lacerte_client_list yields:
 *   { success: true, result: { rows: [...], total, ... }, cid }
 * Each row is a raw DATA1 (DBF) dict:
 *   C1_0 = ClientNumber, C1_1 = FirstName / entity name, C1_2 = LastName,
 *   C1_3 = Email, ClientID = operator-chosen short id.
 *
 * Reusable by other modules — e.g. a compliance/deadline sync can call
 * lacerteListClients to enumerate the firm's tax clients.
 */
import "server-only";

import { callTool, listTools } from "./mcp-client";
import type { McpResult, McpTransportConfig, McpToolInfo } from "./mcp-client";

export type LacerteClient = {
  /** SDK-minted ClientNumber (e.g. "1001"). */
  clientNumber: string;
  /** Operator-chosen short ClientID (e.g. "SMIT"), if present. */
  clientId?: string;
  /** Best-effort display name (entity name or "First Last"). */
  name: string;
  firstName?: string;
  lastName?: string;
  email?: string;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Unwrap Lacerte's { success, result, ... } envelope. */
function unwrap(json: unknown): { ok: boolean; result?: unknown; error?: string } {
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (o.success === false) {
      return { ok: false, error: str(o.userMessage) ?? str(o.statusName) ?? "Lacerte returned an error" };
    }
    if ("result" in o) return { ok: true, result: o.result };
    // Some tools may return the payload directly.
    return { ok: true, result: o };
  }
  return { ok: true, result: json };
}

function normalizeClient(row: Record<string, unknown>): LacerteClient {
  const first = str(row.C1_1) ?? str(row.FirstName);
  const last = str(row.C1_2) ?? str(row.LastName);
  const name = [first, last].filter(Boolean).join(" ").trim() || first || "(unnamed)";
  return {
    clientNumber: String(row.C1_0 ?? row.ClientNumber ?? ""),
    clientId: str(row.ClientID),
    name,
    firstName: first,
    lastName: last,
    email: str(row.C1_3) ?? str(row.Email),
  };
}

/** Connect and list tools — confirms this is the Lacerte server. */
export function lacertePing(
  config: McpTransportConfig,
): Promise<McpResult<McpToolInfo[]>> {
  return listTools(config);
}

/**
 * List clients from DATA1 in the active Lacerte context.
 *
 * Note: a live Lacerte server needs a context (datapath/year/module) set and
 * a valid 24h session before this returns data; if none is set the server
 * surfaces a structured error which we pass through as `error`.
 */
export async function lacerteListClients(
  config: McpTransportConfig,
  opts: { nameFilter?: string; limit?: number; offset?: number } = {},
): Promise<McpResult<LacerteClient[]>> {
  const args: Record<string, unknown> = {};
  if (opts.nameFilter) args.nameFilter = opts.nameFilter;
  if (typeof opts.limit === "number") args.limit = opts.limit;
  if (typeof opts.offset === "number") args.offset = opts.offset;

  const res = await callTool(config, "lacerte_client_list", args);
  if (!res.ok) return res;

  const env = unwrap(res.data.json);
  if (!env.ok) return { ok: false, error: env.error ?? "lacerte_client_list error" };
  if (res.data.isError && env.ok && !env.result) {
    return { ok: false, error: res.data.text || "lacerte_client_list returned an error" };
  }

  const payload = (env.result ?? {}) as { rows?: unknown; clients?: unknown };
  const rows = Array.isArray(payload.rows)
    ? payload.rows
    : Array.isArray(payload.clients)
      ? payload.clients
      : [];
  return {
    ok: true,
    data: rows.map((r) => normalizeClient(r as Record<string, unknown>)),
  };
}

/** Escape hatch for other modules: call any Lacerte tool with raw args. */
export { callTool as lacerteCallTool };
