/**
 * Thin, robust MCP client wrapper for KarbonCopy integrations.
 *
 * The firm's QuickBooks Desktop MCP and Lacerte MCP are BOTH stdio servers —
 * launched as local child processes that speak JSON-RPC over stdin/stdout
 * (see `Quickbooks MCP Desktop/src/index.ts` → StdioServerTransport, and
 * `LacertMCP/src/LacertMCP.Server/Program.cs` → WithStdioServerTransport()).
 *
 * This module connects to a configured server, lists its tools, and calls a
 * tool — all over **localhost** (a child process on the same machine), never
 * the cloud. It is:
 *   - lazy: nothing is spawned until a call is made;
 *   - timed-out: every connect+call is bounded so a hung/missing server can
 *     never wedge the Next.js host process;
 *   - defensive: failures return structured errors instead of throwing past
 *     the boundary, so the UI can show "error" status without crashing.
 *
 * Each call opens a fresh transport and closes it afterward. Integration
 * syncs are infrequent (manual "Test connection" / "Sync clients"), so the
 * simplicity of connect-per-call beats holding a long-lived child process
 * inside a web server.
 */
import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/** How a given MCP server is launched / reached. */
export type McpTransportConfig =
  | {
      transport: "stdio";
      /** Executable to spawn, e.g. "node" or an absolute path to a .exe. */
      command: string;
      /** Args, e.g. ["dist/index.js"]. */
      args?: string[];
      /** Working dir for the child process (the MCP project root). */
      cwd?: string;
      /** Extra env vars (merged over a safe inherited subset). */
      env?: Record<string, string>;
    }
  | {
      transport: "http";
      /** Streamable-HTTP endpoint, e.g. "http://127.0.0.1:8000/mcp". */
      url: string;
      headers?: Record<string, string>;
    };

export type McpToolInfo = {
  name: string;
  description?: string;
};

export type McpResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** A subset of process.env that is safe to forward to a child MCP server. */
function safeInheritedEnv(): Record<string, string> {
  const keep = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SystemDrive",
    "windir",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "COMMONPROGRAMFILES",
    "ProgramData",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "COMSPEC",
  ];
  const out: Record<string, string> = {};
  for (const k of keep) {
    const v = process.env[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function buildTransport(config: McpTransportConfig): Transport {
  if (config.transport === "http") {
    if (!config.url) throw new Error("HTTP transport requires a url");
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
  }
  if (!config.command) throw new Error("stdio transport requires a command");
  return new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd,
    env: { ...safeInheritedEnv(), ...(config.env ?? {}) },
    // Don't let the child's stderr pollute / block the parent web server.
    stderr: "ignore",
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function errMessage(e: unknown): string {
  if (e instanceof Error) {
    // Spawn failures surface as ENOENT etc. — translate to something an
    // operator can act on.
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT")
      return "Server executable not found — check the command/path. Is the MCP server installed?";
    return e.message;
  }
  return String(e);
}

/**
 * Open a connection, run `fn`, and always tear down — even on error/timeout.
 * Never throws; returns a structured McpResult.
 */
export async function withMcpClient<T>(
  config: McpTransportConfig,
  fn: (client: Client) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<McpResult<T>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let client: Client | null = null;
  let transport: Transport | null = null;
  try {
    transport = buildTransport(config);
    client = new Client(
      { name: "karboncopy", version: "1.0.0" },
      { capabilities: {} },
    );
    await withTimeout(client.connect(transport), timeoutMs, "MCP connect");
    const data = await withTimeout(fn(client), timeoutMs, "MCP call");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  } finally {
    // Closing the client closes the transport (and kills the child process
    // for stdio). Best-effort — never let teardown throw past the boundary.
    try {
      await client?.close();
    } catch {
      /* ignore */
    }
    try {
      await transport?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Connect and list the server's tools. Used by "Test connection". */
export async function listTools(
  config: McpTransportConfig,
  opts: { timeoutMs?: number } = {},
): Promise<McpResult<McpToolInfo[]>> {
  return withMcpClient(
    config,
    async (client) => {
      const res = await client.listTools();
      return res.tools.map((t) => ({
        name: t.name,
        description: t.description,
      }));
    },
    opts,
  );
}

/** Raw text/JSON content extracted from an MCP CallToolResult. */
export type McpCallResult = {
  isError: boolean;
  /** Concatenated text content blocks. */
  text: string;
  /** Parsed JSON if the text was a JSON document, else undefined. */
  json?: unknown;
};

/**
 * Call a single tool by name. Both firm servers return their payloads as a
 * JSON string inside a text content block, so we parse opportunistically.
 */
export async function callTool(
  config: McpTransportConfig,
  name: string,
  args: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {},
): Promise<McpResult<McpCallResult>> {
  return withMcpClient(
    config,
    async (client) => {
      const res = await client.callTool({ name, arguments: args });
      const content = Array.isArray(res.content) ? res.content : [];
      const text = content
        .filter((c): c is { type: "text"; text: string } => c?.type === "text")
        .map((c) => c.text)
        .join("\n");
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      return { isError: Boolean(res.isError), text, json };
    },
    opts,
  );
}
