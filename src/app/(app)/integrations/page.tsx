import { asc } from "drizzle-orm";
import { Plug, ShieldAlert } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser, hasRole } from "@/lib/auth";
import { parseStoredConfig, toPublicConfig } from "@/lib/integrations/config";
import { IntegrationsBoard } from "@/components/integrations/integrations-board";

export const dynamic = "force-dynamic";

const { integrationConfigs } = schema;

export default async function IntegrationsPage() {
  const user = await requireUser();

  if (!hasRole(user, "admin")) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warning/15 text-warning">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Admin access required</h1>
          <p className="mt-1 text-muted-foreground">
            Integrations connect KarbonCopy to QuickBooks Desktop and Lacerte over your local
            network. Only firm owners and admins can configure them.
          </p>
        </div>
      </div>
    );
  }

  const rows = await db
    .select()
    .from(integrationConfigs)
    .orderBy(asc(integrationConfigs.createdAt));

  // Strip ciphertext before handing config to the client.
  const items = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    label: r.label,
    enabled: r.enabled,
    status: r.status,
    lastError: r.lastError,
    lastSyncAt: r.lastSyncAt ? r.lastSyncAt.getTime() : null,
    config: toPublicConfig(parseStoredConfig(r.config)),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Plug className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
          <p className="text-muted-foreground">
            Connect to your firm&apos;s QuickBooks Desktop and Lacerte MCP servers over localhost —
            data never leaves your network.
          </p>
        </div>
      </div>

      <IntegrationsBoard items={items} />
    </div>
  );
}
