import { KeyRound, ShieldAlert } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser, hasRole } from "@/lib/auth";
import { listApiKeys } from "@/lib/api/auth";
import { ApiKeysManager } from "@/components/settings/api-keys-manager";

export const dynamic = "force-dynamic";

const { users } = schema;

export default async function ApiKeysSettingsPage() {
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
            API key management is limited to firm owners and admins.
          </p>
        </div>
      </div>
    );
  }

  const [keys, activeUsers] = await Promise.all([
    listApiKeys(),
    db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.name)),
  ]);

  // Build a lookup so the manager can render the "acts as" user name per key.
  const userMap: Record<string, string> = {};
  for (const u of activeUsers) userMap[u.id] = u.name;

  // Default the "acts as" selector to the current admin (the firm owner/admin
  // running this page), falling back to the first active user.
  const defaultUserId =
    activeUsers.find((u) => u.id === user.id)?.id ?? activeUsers[0]?.id ?? "";

  const initialKeys = keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    userId: k.userId,
    userName: userMap[k.userId] ?? "Unknown user",
    revoked: k.revoked,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.getTime() : null,
    expiresAt: k.expiresAt ? k.expiresAt.getTime() : null,
    createdAt: k.createdAt ? k.createdAt.getTime() : null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <KeyRound className="h-6 w-6 text-primary" />
          API keys
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          These keys grant programmatic access to the{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/api/v1</code> REST
          surface and the MCP server. A key acts <strong>as the chosen user</strong> and inherits
          that user&apos;s role and permissions, so only mint keys for trusted automations. The
          raw key is shown once at creation and stored only as a hash — treat it like a password.
        </p>
      </div>

      <ApiKeysManager
        initialKeys={initialKeys}
        users={activeUsers}
        defaultUserId={defaultUserId}
      />
    </div>
  );
}
