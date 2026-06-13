/**
 * integrationConfigs.config (JSON) shapes + secret handling.
 *
 * The DB column `integrationConfigs.config` is free-form JSON. This module
 * defines the typed shape KarbonCopy writes/reads and centralizes how the
 * launch command + folder paths + secrets are persisted. Any secret value
 * (env vars passed to the child process — e.g. an Intuit app id, a company
 * file password) is encrypted at rest via lib/crypto and only decrypted at
 * connect time, on the server.
 */
import "server-only";

import { encryptField, decryptField } from "@/lib/crypto";
import type { McpTransportConfig } from "./mcp-client";
import type { StoredIntegrationConfig } from "./config-shared";

// Re-export the client-safe types/helpers so server callers can keep importing
// everything from "./config" while client components import "./config-shared".
export type { IntegrationKind, StoredIntegrationConfig, PublicIntegrationConfig } from "./config-shared";
export { parseStoredConfig, toPublicConfig, defaultConfigForKind } from "./config-shared";

/** Decrypt the env-var secrets blob. Never throws. */
export function decryptEnv(stored: StoredIntegrationConfig): Record<string, string> {
  if (!stored.envEnc) return {};
  const plain = decryptField(stored.envEnc);
  if (!plain) return {};
  try {
    const obj = JSON.parse(plain);
    if (obj && typeof obj === "object") {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Encrypt an env-var map for storage. Returns null for empty maps. */
export function encryptEnv(env: Record<string, string> | undefined | null): string | null {
  if (!env || Object.keys(env).length === 0) return null;
  return encryptField(JSON.stringify(env));
}

/** Build a live transport config (with secrets decrypted) for the MCP client. */
export function toTransportConfig(
  stored: StoredIntegrationConfig,
): McpTransportConfig {
  if (stored.transport === "http") {
    return { transport: "http", url: stored.url ?? "" };
  }
  return {
    transport: "stdio",
    command: stored.command ?? "",
    args: stored.args ?? [],
    cwd: stored.cwd,
    env: decryptEnv(stored),
  };
}

