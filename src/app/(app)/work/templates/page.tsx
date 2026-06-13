import Link from "next/link";
import { asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { TemplatesClient, type TemplateRow } from "@/components/work/templates-client";
import type { WorkUser } from "@/components/work/types";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const [templates, workTypes, orgs, users, statuses] = await Promise.all([
    db.select().from(schema.workTemplates).orderBy(asc(schema.workTemplates.name)),
    db.select({ id: schema.workTypes.id, name: schema.workTypes.name }).from(schema.workTypes),
    db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(isNull(schema.organizations.deletedAt))
      .orderBy(asc(schema.organizations.name)),
    db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        image: schema.users.image,
        color: schema.users.color,
      })
      .from(schema.users)
      .where(eq(schema.users.active, true))
      .orderBy(asc(schema.users.name)),
    db.select().from(schema.workStatuses).orderBy(asc(schema.workStatuses.position)),
  ]);

  // Task counts per template.
  const ids = templates.map((t) => t.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const rows = await db
      .select({ templateId: schema.templateTasks.templateId, total: sql<number>`count(*)` })
      .from(schema.templateTasks)
      .where(inArray(schema.templateTasks.templateId, ids))
      .groupBy(schema.templateTasks.templateId);
    for (const r of rows) counts.set(r.templateId, Number(r.total));
  }

  const wtName = new Map(workTypes.map((w) => [w.id, w.name]));
  const rows: TemplateRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    defaultBudgetMinutes: t.defaultBudgetMinutes,
    workTypeName: t.workTypeId ? wtName.get(t.workTypeId) ?? null : null,
    taskCount: counts.get(t.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/work"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to work
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Work templates</h1>
        <p className="text-muted-foreground">
          Spin up a recurring engagement and its full checklist in one click.
        </p>
      </div>

      <TemplatesClient templates={rows} orgs={orgs} users={users as WorkUser[]} statuses={statuses} />
    </div>
  );
}
