import { asc, eq, inArray } from "drizzle-orm";
import { Settings as SettingsIcon, ShieldAlert } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser, hasRole } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsShell } from "@/components/settings/settings-shell";

export const dynamic = "force-dynamic";

const { watchedRoots, fileRules, users, automators, settings } = schema;

export default async function SettingsPage() {
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
            Settings are limited to firm owners and admins. Ask your administrator if you need
            access to watched folders, rules, or user management.
          </p>
        </div>
      </div>
    );
  }

  const [roots, rules, userRows, autos, settingRows] = await Promise.all([
    db.select().from(watchedRoots).orderBy(asc(watchedRoots.createdAt)),
    db.select().from(fileRules).orderBy(asc(fileRules.createdAt)),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        active: users.active,
        weeklyCapacityMinutes: users.weeklyCapacityMinutes,
      })
      .from(users)
      .orderBy(asc(users.name)),
    db.select().from(automators).orderBy(asc(automators.createdAt)),
    db.select().from(settings).where(inArray(settings.key, ["firmName", "supportEmail"])),
  ]);

  const ruleCounts: Record<string, number> = {};
  for (const r of rules) ruleCounts[r.rootId] = (ruleCounts[r.rootId] ?? 0) + 1;

  const settingMap = new Map(settingRows.map((s) => [s.key, s.value]));
  const firmName = typeof settingMap.get("firmName") === "string" ? (settingMap.get("firmName") as string) : "";
  const supportEmail =
    typeof settingMap.get("supportEmail") === "string" ? (settingMap.get("supportEmail") as string) : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <SettingsIcon className="h-6 w-6 text-primary" />
          Settings
        </h1>
        <p className="text-muted-foreground">
          Watched folders, file rules, users, automators, and firm configuration.
        </p>
      </div>

      <SettingsShell
        roots={roots}
        rules={rules}
        ruleCounts={ruleCounts}
        users={userRows}
        automators={autos}
        currentUserId={user.id}
        firmName={firmName}
        supportEmail={supportEmail}
      />
    </div>
  );
}
