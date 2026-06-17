import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { parseStoredConfig, toTransportConfig } from "@/lib/integrations/config";
import { listTools } from "@/lib/integrations/mcp-client";

const { integrationConfigs } = schema;

/**
 * POST /api/integrations/[id]/test
 * Connects to the configured MCP server over localhost, lists its tools, and
 * updates the integration's status (ok / error / unconfigured) + lastError.
 * Admin-only. Never throws — a missing/un-launched server returns 200 with
 * { ok:false } and an "error" status so the UI can render it cleanly.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user, "admin"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  try {
    const [row] = await db
      .select()
      .from(integrationConfigs)
      .where(eq(integrationConfigs.id, id))
      .limit(1);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const stored = parseStoredConfig(row.config);
    const transport = toTransportConfig(stored);

    if (transport.transport === "stdio" && !transport.command) {
      await db
        .update(integrationConfigs)
        .set({ status: "unconfigured", lastError: "No launch command configured" })
        .where(eq(integrationConfigs.id, id));
      return NextResponse.json({ ok: false, status: "unconfigured", error: "No launch command configured" });
    }

    const res = await listTools(transport);
    if (!res.ok) {
      await db
        .update(integrationConfigs)
        .set({ status: "error", lastError: res.error })
        .where(eq(integrationConfigs.id, id));
      return NextResponse.json({ ok: false, status: "error", error: res.error });
    }

    await db
      .update(integrationConfigs)
      .set({ status: "ok", lastError: null })
      .where(eq(integrationConfigs.id, id));
    return NextResponse.json({
      ok: true,
      status: "ok",
      toolCount: res.data.length,
      tools: res.data.slice(0, 12).map((t) => t.name),
    });
  } catch (err) {
    // Contract: this route never throws — surface DB/transport failures as a
    // clean { ok:false, status:"error" } body the UI can render.
    return NextResponse.json(
      { ok: false, status: "error", error: (err as Error).message || "Integration test failed" },
      { status: 500 },
    );
  }
}
