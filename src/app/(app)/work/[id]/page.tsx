import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ArrowLeft, ListChecks, MessageSquare, Activity as ActivityIcon } from "lucide-react";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailHeader } from "@/components/work/detail-header";
import { TaskChecklist } from "@/components/work/task-checklist";
import { CommentThread } from "@/components/work/comment-thread";
import { ActivityTimeline } from "@/components/work/activity-timeline";
import type { WorkUser, WorkContact } from "@/components/work/types";

export const dynamic = "force-dynamic";

export default async function WorkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [item] = await db
    .select()
    .from(schema.workItems)
    .where(and(eq(schema.workItems.id, id), isNull(schema.workItems.deletedAt)))
    .limit(1);

  if (!item) notFound();

  const [statuses, users, orgs, contactRows, workTypes, tasks, comments, activities] = await Promise.all([
    db.select().from(schema.workStatuses).orderBy(asc(schema.workStatuses.position)),
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
    db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(isNull(schema.organizations.deletedAt))
      .orderBy(asc(schema.organizations.name)),
    db
      .select({
        id: schema.contacts.id,
        firstName: schema.contacts.firstName,
        lastName: schema.contacts.lastName,
        organizationId: schema.contacts.organizationId,
      })
      .from(schema.contacts)
      .where(isNull(schema.contacts.deletedAt))
      .orderBy(asc(schema.contacts.lastName), asc(schema.contacts.firstName)),
    db
      .select({
        id: schema.workTypes.id,
        name: schema.workTypes.name,
        color: schema.workTypes.color,
        defaultBudgetMinutes: schema.workTypes.defaultBudgetMinutes,
      })
      .from(schema.workTypes),
    db
      .select()
      .from(schema.workTasks)
      .where(eq(schema.workTasks.workItemId, id))
      .orderBy(asc(schema.workTasks.position), asc(schema.workTasks.createdAt)),
    db
      .select()
      .from(schema.comments)
      .where(and(eq(schema.comments.entityKind, "work_item"), eq(schema.comments.entityId, id)))
      .orderBy(asc(schema.comments.createdAt)),
    db
      .select()
      .from(schema.activities)
      .where(and(eq(schema.activities.entityKind, "work_item"), eq(schema.activities.entityId, id)))
      .orderBy(desc(schema.activities.createdAt))
      .limit(50),
  ]);

  const contacts: WorkContact[] = contactRows.map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim(),
    organizationId: c.organizationId,
  }));

  const orgName = item.organizationId
    ? orgs.find((o) => o.id === item.organizationId)?.name ?? null
    : null;
  const workTypeName = item.workTypeId
    ? workTypes.find((w) => w.id === item.workTypeId)?.name ?? null
    : null;

  return (
    <div className="space-y-6">
      <Link
        href="/work"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to work
      </Link>

      <DetailHeader
        item={item}
        statuses={statuses}
        users={users as WorkUser[]}
        orgs={orgs}
        contacts={contacts}
        workTypes={workTypes}
        orgName={orgName}
        workTypeName={workTypeName}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ListChecks className="h-4 w-4" /> Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TaskChecklist workItemId={id} tasks={tasks} isComplete={!!item.completedAt} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="h-4 w-4" /> Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CommentThread workItemId={id} comments={comments} users={users as WorkUser[]} />
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ActivityIcon className="h-4 w-4" /> Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline activities={activities} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
