/**
 * Client-safe integration config types + pure helpers (NO server-only, NO crypto).
 * Safe to import from client components. Secret handling lives in ./config.ts.
 */

export type IntegrationKind =
  | "quickbooks_desktop"
  | "quickbooks_online"
  | "lacerte"
  | "drake"
  | "ultratax";

export type StoredIntegrationConfig = {
  transport?: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  /** Encrypted JSON object of env-var secrets (lib/crypto). Server-only writes/reads. */
  envEnc?: string | null;
  dataFolderPath?: string;
};

/** A client-safe view — strips the encrypted secrets blob, exposes a boolean. */
export type PublicIntegrationConfig = Omit<StoredIntegrationConfig, "envEnc"> & {
  hasSecrets: boolean;
};

/** Parse the raw JSON column into our typed shape (defensive). Pure. */
export function parseStoredConfig(
  raw: Record<string, unknown> | null | undefined,
): StoredIntegrationConfig {
  const c = (raw ?? {}) as StoredIntegrationConfig;
  return {
    transport: c.transport === "http" ? "http" : "stdio",
    command: typeof c.command === "string" ? c.command : undefined,
    args: Array.isArray(c.args) ? c.args.filter((a) => typeof a === "string") : undefined,
    cwd: typeof c.cwd === "string" ? c.cwd : undefined,
    url: typeof c.url === "string" ? c.url : undefined,
    envEnc: typeof c.envEnc === "string" ? c.envEnc : null,
    dataFolderPath: typeof c.dataFolderPath === "string" ? c.dataFolderPath : undefined,
  };
}

/** Strip ciphertext for the browser. Pure. */
export function toPublicConfig(stored: StoredIntegrationConfig): PublicIntegrationConfig {
  const { envEnc, ...rest } = stored;
  return { ...rest, hasSecrets: Boolean(envEnc) };
}

/** Sensible launch defaults per kind, shown as placeholders in the UI. Pure. */
export function defaultConfigForKind(kind: IntegrationKind): StoredIntegrationConfig {
  switch (kind) {
    case "quickbooks_desktop":
    case "quickbooks_online":
      return {
        transport: "stdio",
        command: "node",
        args: ["dist/index.js"],
        cwd: "C:\\Users\\VR\\projects\\Quickbooks MCP Desktop",
      };
    case "lacerte":
      return {
        transport: "stdio",
        command:
          "C:\\Users\\VR\\projects\\LacertMCP\\src\\LacertMCP.Server\\bin\\Debug\\net48\\LacertMCP.Server.exe",
        args: [],
        cwd: "C:\\Users\\VR\\projects\\LacertMCP\\src\\LacertMCP.Server\\bin\\Debug\\net48",
      };
    default:
      return { transport: "stdio", command: "node", args: [] };
  }
}
