"use server";

import { revalidatePath } from "next/cache";
import { eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { EntityType } from "@/db/schema";
import { requireAdmin, requireWrite } from "@/lib/auth";
import {
  parseStoredConfig,
  toTransportConfig,
  encryptEnv,
  type IntegrationKind,
  type StoredIntegrationConfig,
} from "@/lib/integrations/config";
import { listTools } from "@/lib/integrations/mcp-client";
import { qbListCustomers } from "@/lib/integrations/quickbooks";
import { lacerteListClients } from "@/lib/integrations/lacerte";

const { integrationConfigs, organizations, activities } = schema;

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  const msg = (err as Error)?.message ?? "Something went wrong";
  if (msg === "FORBIDDEN") return { ok: false, error: "Admin access required" };
  if (msg === "UNAUTHENTICATED") return { ok: false, error: "Please sign in" };
  return { ok: false, error: msg };
}

async function audit(actorId: string, verb: string, summary: string, entityId: string) {
  try {
    await db.insert(activities).values({
      actorId,
      verb,
      entityKind: "setting",
      entityId,
      summary,
    });
  } catch {
    /* best-effort */
  }
}

const KINDS: IntegrationKind[] = [
  "quickbooks_desktop",
  "quickbooks_online",
  "lacerte",
  "drake",
  "ultratax",
];

/** Build the config blob to persist, encrypting any env-var secrets. */
function buildConfig(input: {
  transport?: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  dataFolderPath?: string;
  env?: Record<string, string>;
  /** Preserve existing encrypted secrets when env is omitted on edit. */
  existingEnvEnc?: string | null;
}): StoredIntegrationConfig {
  const envEnc =
    input.env !== undefined ? encryptEnv(input.env) : (input.existingEnvEnc ?? null);
  return {
    transport: input.transport === "http" ? "http" : "stdio",
    command: input.command?.trim() || undefined,
    args: input.args?.filter((a) => a.trim().length).map((a) => a.trim()),
    cwd: input.cwd?.trim() || undefined,
    url: input.url?.trim() || undefined,
    dataFolderPath: input.dataFolderPath?.trim() || undefined,
    envEnc,
  };
}

export type IntegrationInput = {
  kind: IntegrationKind;
  label: string;
  enabled: boolean;
  transport?: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  dataFolderPath?: string;
  /** Plaintext env-var secrets; encrypted before storage. */
  env?: Record<string, string>;
};

export async function createIntegration(
  input: IntegrationInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    if (!KINDS.includes(input.kind)) return { ok: false, error: "Unknown integration kind" };
    if (!input.label.trim()) return { ok: false, error: "Label is required" };

    const config = buildConfig(input);
    const [row] = await db
      .insert(integrationConfigs)
      .values({
        kind: input.kind,
        label: input.label.trim(),
        enabled: input.enabled,
        status: "unconfigured",
        config,
      })
      .returning({ id: integrationConfigs.id });
    if (!row) throw new Error("Integration could not be created.");

    await audit(user.id, "created", `Added integration “${input.label.trim()}”`, row.id);
    revalidatePath("/integrations");
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function updateIntegration(
  id: string,
  input: Partial<IntegrationInput>,
): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    const [existing] = await db
      .select()
      .from(integrationConfigs)
      .where(eq(integrationConfigs.id, id))
      .limit(1);
    if (!existing) return { ok: false, error: "Integration not found" };

    const prevConfig = parseStoredConfig(existing.config);
    const config = buildConfig({
      transport: input.transport ?? prevConfig.transport,
      command: input.command ?? prevConfig.command,
      args: input.args ?? prevConfig.args,
      cwd: input.cwd ?? prevConfig.cwd,
      url: input.url ?? prevConfig.url,
      dataFolderPath: input.dataFolderPath ?? prevConfig.dataFolderPath,
      env: input.env, // undefined → keep existing secrets
      existingEnvEnc: prevConfig.envEnc,
    });

    await db
      .update(integrationConfigs)
      .set({
        label: input.label?.trim() || existing.label,
        enabled: input.enabled ?? existing.enabled,
        config,
        // Re-test needed after a config change.
        status: "unconfigured",
        lastError: null,
      })
      .where(eq(integrationConfigs.id, id));

    await audit(user.id, "updated", `Updated integration “${existing.label}”`, id);
    revalidatePath("/integrations");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteIntegration(id: string): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    const [existing] = await db
      .select({ label: integrationConfigs.label })
      .from(integrationConfigs)
      .where(eq(integrationConfigs.id, id));
    await db.delete(integrationConfigs).where(eq(integrationConfigs.id, id));
    if (existing) await audit(user.id, "deleted", `Removed integration “${existing.label}”`, id);
    revalidatePath("/integrations");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Connect to the MCP server and list its tools. Updates status ok/error +
 * lastError. Never throws past the boundary — a missing/un-launched server
 * yields a clear "error" status, not a crash.
 */
export async function testConnection(
  id: string,
): Promise<ActionResult<{ toolCount: number; sampleTools: string[] }>> {
  try {
    await requireAdmin();
    const [row] = await db
      .select()
      .from(integrationConfigs)
      .where(eq(integrationConfigs.id, id))
      .limit(1);
    if (!row) return { ok: false, error: "Integration not found" };

    const stored = parseStoredConfig(row.config);
    const transport = toTransportConfig(stored);
    if (transport.transport === "stdio" && !transport.command) {
      await db
        .update(integrationConfigs)
        .set({ status: "unconfigured", lastError: "No launch command configured" })
        .where(eq(integrationConfigs.id, id));
      revalidatePath("/integrations");
      return { ok: false, error: "No launch command configured" };
    }

    const res = await listTools(transport);
    if (!res.ok) {
      await db
        .update(integrationConfigs)
        .set({ status: "error", lastError: res.error })
        .where(eq(integrationConfigs.id, id));
      revalidatePath("/integrations");
      return { ok: false, error: res.error };
    }

    await db
      .update(integrationConfigs)
      .set({ status: "ok", lastError: null })
      .where(eq(integrationConfigs.id, id));
    revalidatePath("/integrations");
    return {
      ok: true,
      data: {
        toolCount: res.data.length,
        sampleTools: res.data.slice(0, 8).map((t) => t.name),
      },
    };
  } catch (err) {
    return fail(err);
  }
}

/** Map a tax-prep entity hint to a KarbonCopy EntityType. */
function guessEntityType(kind: IntegrationKind): EntityType {
  return kind === "lacerte" ? "individual" : "c_corp";
}

/**
 * Pull customers (QB) / clients (Lacerte) and create-or-link organizations.
 * Idempotent by name (case-insensitive): an existing org with the same name
 * is left in place (not duplicated); only missing names are inserted.
 * requireWrite (staff+), since it creates CRM records.
 */
export async function syncClients(
  id: string,
): Promise<ActionResult<{ created: number; matched: number; total: number }>> {
  try {
    const user = await requireWrite();
    const [row] = await db
      .select()
      .from(integrationConfigs)
      .where(eq(integrationConfigs.id, id))
      .limit(1);
    if (!row) return { ok: false, error: "Integration not found" };

    const stored = parseStoredConfig(row.config);
    const transport = toTransportConfig(stored);

    // Pull names from the right server.
    let names: string[];
    if (row.kind === "lacerte") {
      const res = await lacerteListClients(transport);
      if (!res.ok) {
        await db
          .update(integrationConfigs)
          .set({ status: "error", lastError: res.error })
          .where(eq(integrationConfigs.id, id));
        revalidatePath("/integrations");
        return { ok: false, error: res.error };
      }
      names = res.data.map((c) => c.name);
    } else {
      // quickbooks_desktop / quickbooks_online
      const res = await qbListCustomers(transport);
      if (!res.ok) {
        await db
          .update(integrationConfigs)
          .set({ status: "error", lastError: res.error })
          .where(eq(integrationConfigs.id, id));
        revalidatePath("/integrations");
        return { ok: false, error: res.error };
      }
      names = res.data.map((c) => c.name);
    }

    // De-dupe + drop blanks/placeholders.
    const wanted = [...new Set(names.map((n) => n.trim()).filter((n) => n && n !== "(unnamed)"))];

    // Existing org names (active only), lower-cased for case-insensitive match.
    const existing = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(isNull(organizations.deletedAt));
    const existingLower = new Set(existing.map((o) => o.name.trim().toLowerCase()));

    const entityType = guessEntityType(row.kind);
    let created = 0;
    let matched = 0;

    for (const name of wanted) {
      if (existingLower.has(name.toLowerCase())) {
        matched += 1;
        continue;
      }
      await db.insert(organizations).values({ name, entityType, isClient: true });
      existingLower.add(name.toLowerCase());
      created += 1;
    }

    await db
      .update(integrationConfigs)
      .set({ status: "ok", lastError: null, lastSyncAt: new Date() })
      .where(eq(integrationConfigs.id, id));

    await audit(
      user.id,
      "synced",
      `Synced ${wanted.length} client(s) from “${row.label}” (${created} new, ${matched} linked)`,
      id,
    );
    revalidatePath("/integrations");
    return { ok: true, data: { created, matched, total: wanted.length } };
  } catch (err) {
    return fail(err);
  }
}
