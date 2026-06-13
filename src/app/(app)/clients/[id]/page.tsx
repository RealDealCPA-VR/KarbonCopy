import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  ArrowLeft, Briefcase, Building2, Users as UsersIcon, FileText, Globe,
  Mail, Phone, MapPin, ExternalLink, CalendarDays, Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { db, schema } from "@/db";
import { requireUser, hasRole } from "@/lib/auth";
import { decryptField, maskTaxId } from "@/lib/crypto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { colorForId } from "@/lib/utils";
import {
  entityTypeLabel, formatFiscalYearEnd,
} from "@/components/clients/entity-types";
import { UserAvatar } from "@/components/clients/user-avatar";
import { DetailTabs } from "@/components/clients/detail-tabs";
import { DetailHeaderActions } from "@/components/clients/detail-header-actions";
import { ContactsTab } from "@/components/clients/contacts-tab";
import { NotesTab, type NoteItem } from "@/components/clients/notes-tab";
import { CustomFields, type CustomFieldDef } from "@/components/clients/custom-fields";
import type { Activity, Document, Organization, WorkItem, WorkStatus } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const currentUser = await requireUser();

  const [orgRow] = await db
    .select()
    .from(schema.organizations)
    .where(and(eq(schema.organizations.id, id), isNull(schema.organizations.deletedAt)))
    .limit(1);

  if (!orgRow) notFound();

  // EIN is encrypted at rest. Decrypt server-side, then expose to the client only
  // as a mask by default. Cleartext is provided ONLY to managers and ONLY where
  // editing requires it (the Edit dialog / Overview), never in any list payload.
  const einPlain = decryptField(orgRow.ein);
  const einMasked = maskTaxId(einPlain);
  const canViewEin = hasRole(currentUser, "manager");

  // The org object handed to client components carries cleartext EIN only for
  // managers (so the Edit dialog can pre-fill it); everyone else gets null.
  const org = { ...orgRow, ein: canViewEin ? einPlain : null };

  const [
    users,
    contacts,
    workItems,
    statuses,
    documents,
    cfDefs,
    cfValues,
    commentRows,
  ] = await Promise.all([
    db
      .select({ id: schema.users.id, name: schema.users.name, image: schema.users.image, color: schema.users.color })
      .from(schema.users)
      .where(eq(schema.users.active, true))
      .orderBy(schema.users.name),
    db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, id), isNull(schema.contacts.deletedAt)))
      .orderBy(desc(schema.contacts.isPrimary), schema.contacts.lastName),
    db
      .select()
      .from(schema.workItems)
      .where(and(eq(schema.workItems.organizationId, id), isNull(schema.workItems.deletedAt)))
      .orderBy(desc(schema.workItems.dueDate)),
    db.select().from(schema.workStatuses),
    db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.organizationId, id))
      .orderBy(desc(schema.documents.createdAt)),
    db
      .select()
      .from(schema.customFields)
      .where(eq(schema.customFields.entityKind, "organization"))
      .orderBy(schema.customFields.position),
    db.select().from(schema.customFieldValues).where(eq(schema.customFieldValues.entityId, id)),
    db
      .select()
      .from(schema.comments)
      .where(and(eq(schema.comments.entityKind, "organization"), eq(schema.comments.entityId, id)))
      .orderBy(desc(schema.comments.createdAt)),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const owner = org.ownerId ? userMap.get(org.ownerId) : undefined;
  const statusMap = new Map(statuses.map((s) => [s.id, s]));

  const openWork = workItems.filter((w) => !w.completedAt);

  // Timeline = activities for the org + its work items, merged & sorted.
  const workIds = workItems.map((w) => w.id);
  const activityRows = await db
    .select()
    .from(schema.activities)
    .where(
      or(
        and(eq(schema.activities.entityKind, "organization"), eq(schema.activities.entityId, id)),
        workIds.length
          ? and(eq(schema.activities.entityKind, "work_item"), inArray(schema.activities.entityId, workIds))
          : sql`0 = 1`,
      ),
    )
    .orderBy(desc(schema.activities.createdAt))
    .limit(60);

  // Custom field defs joined with their values.
  const valueMap = new Map(cfValues.map((v) => [v.fieldId, v.value]));
  const customFields: CustomFieldDef[] = cfDefs.map((d) => ({
    id: d.id,
    label: d.label,
    fieldType: d.fieldType,
    options: d.options ?? null,
    value: valueMap.get(d.id) ?? null,
  }));

  const notes: NoteItem[] = commentRows.map((c) => {
    const a = userMap.get(c.authorId);
    return {
      id: c.id,
      body: c.body,
      createdAt: new Date(c.createdAt),
      authorId: c.authorId,
      authorName: a?.name ?? "Unknown",
      authorImage: a?.image ?? null,
      authorColor: a?.color ?? null,
    };
  });

  const accent = colorForId(org.id);

  const stats = [
    { label: "Open work", value: openWork.length, icon: Briefcase },
    { label: "Contacts", value: contacts.length, icon: UsersIcon },
    { label: "Documents", value: documents.length, icon: FileText },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All clients
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white"
            style={{ backgroundColor: accent }}
          >
            <Building2 className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{entityTypeLabel(org.entityType)}</Badge>
              {owner ? (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <UserAvatar user={owner} className="h-5 w-5" /> {owner.name}
                </span>
              ) : (
                <span className="text-sm italic text-muted-foreground">No relationship manager</span>
              )}
              {org.fiscalYearEnd && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" /> FYE {formatFiscalYearEnd(org.fiscalYearEnd)}
                </span>
              )}
            </div>
          </div>
        </div>
        <DetailHeaderActions org={org} canEditEin={canViewEin} users={users.map((u) => ({ id: u.id, name: u.name }))} />
      </div>

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums">{s.value}</div>
                <div className="text-sm text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <DetailTabs
        counts={{
          contacts: contacts.length,
          work: openWork.length,
          documents: documents.length,
          notes: notes.length,
        }}
        overview={<OverviewTab org={org} einMasked={einMasked} customFields={customFields} />}
        contacts={<ContactsTab organizationId={org.id} contacts={contacts} />}
        work={<WorkTab workItems={workItems} statusMap={statusMap} userMap={userMap} />}
        documents={<DocumentsTab documents={documents} userMap={userMap} />}
        timeline={<TimelineTab activities={activityRows} userMap={userMap} />}
        notes={<NotesTab organizationId={org.id} notes={notes} />}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                           */
/* ------------------------------------------------------------------ */

function OverviewTab({
  org,
  einMasked,
  customFields,
}: {
  org: Organization;
  einMasked: string;
  customFields: CustomFieldDef[];
}) {
  const rows: { icon: typeof Mail; label: string; node: React.ReactNode }[] = [];
  if (org.email)
    rows.push({ icon: Mail, label: "Email", node: <a href={`mailto:${org.email}`} className="hover:text-primary">{org.email}</a> });
  if (org.phone)
    rows.push({ icon: Phone, label: "Phone", node: <a href={`tel:${org.phone}`} className="hover:text-primary">{org.phone}</a> });
  if (org.website)
    rows.push({
      icon: Globe,
      label: "Website",
      node: (
        <a href={org.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
          {org.website} <ExternalLink className="h-3 w-3" />
        </a>
      ),
    });
  if (org.address) rows.push({ icon: MapPin, label: "Address", node: org.address });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Entity type" value={entityTypeLabel(org.entityType)} />
            <Field label="EIN" value={einMasked} mono />
            <Field label="Fiscal year end" value={formatFiscalYearEnd(org.fiscalYearEnd)} />
            <Field
              label="Status"
              value={org.isClient ? "Active client" : "Prospect / non-client"}
            />
          </dl>

          {rows.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2.5 text-sm">
                {rows.map((r) => (
                  <div key={r.label} className="flex items-center gap-3">
                    <r.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">{r.node}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {org.notes && (
            <>
              <Separator />
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</div>
                <p className="whitespace-pre-wrap text-sm">{org.notes}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom fields</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomFields entityId={org.id} fields={customFields} />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-0.5 font-mono text-sm" : "mt-0.5 text-sm"}>{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Work                                                               */
/* ------------------------------------------------------------------ */

function WorkTab({
  workItems,
  statusMap,
  userMap,
}: {
  workItems: WorkItem[];
  statusMap: Map<string, WorkStatus>;
  userMap: Map<string, { id: string; name: string; image: string | null; color: string | null }>;
}) {
  if (workItems.length === 0) {
    return <EmptyTab icon={Briefcase} text="No work items for this client yet." />;
  }
  const now = new Date();
  return (
    <Card>
      <CardContent className="divide-y p-0">
        {workItems.map((w) => {
          const status = w.statusId ? statusMap.get(w.statusId) : undefined;
          const assignee = w.assigneeId ? userMap.get(w.assigneeId) : undefined;
          const overdue = w.dueDate && !w.completedAt && new Date(w.dueDate) < now;
          return (
            <Link
              key={w.id}
              href={`/work/${w.id}`}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/50"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{w.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  {status && <span>{status.name}</span>}
                  {w.dueDate && (
                    <span className={overdue ? "text-destructive" : ""}>
                      · due {formatDistanceToNow(new Date(w.dueDate), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>
              {w.completedAt ? (
                <Badge variant="success">Done</Badge>
              ) : overdue ? (
                <Badge variant="destructive">Overdue</Badge>
              ) : null}
              {assignee && <UserAvatar user={assignee} className="h-7 w-7" />}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Documents                                                          */
/* ------------------------------------------------------------------ */

function DocumentsTab({
  documents,
  userMap,
}: {
  documents: Document[];
  userMap: Map<string, { id: string; name: string }>;
}) {
  if (documents.length === 0) {
    return <EmptyTab icon={FileText} text="No documents linked to this client." />;
  }
  return (
    <Card>
      <CardContent className="divide-y p-0">
        {documents.map((d) => {
          const by = d.uploadedById ? userMap.get(d.uploadedById) : undefined;
          return (
            <div key={d.id} className="flex items-center gap-3 px-5 py-3">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.name}</div>
                <div className="text-xs text-muted-foreground">
                  {by ? `${by.name} · ` : ""}
                  {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}
                  {d.version > 1 ? ` · v${d.version}` : ""}
                </div>
              </div>
              <Badge variant="outline">{d.source}</Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                           */
/* ------------------------------------------------------------------ */

function TimelineTab({
  activities,
  userMap,
}: {
  activities: Activity[];
  userMap: Map<string, { id: string; name: string; image: string | null; color: string | null }>;
}) {
  if (activities.length === 0) {
    return <EmptyTab icon={Clock} text="No activity recorded yet." />;
  }
  return (
    <div className="relative space-y-0 pl-2">
      {activities.map((a, i) => {
        const actor = a.actorId ? userMap.get(a.actorId) : undefined;
        return (
          <div key={a.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
              {i < activities.length - 1 && <span className="w-px flex-1 bg-border" />}
            </div>
            <div className="pb-5">
              <p className="text-sm">{a.summary}</p>
              <p className="text-xs text-muted-foreground">
                {actor ? `${actor.name} · ` : ""}
                {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function EmptyTab({ icon: Icon, text }: { icon: typeof Briefcase; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
      <Icon className="h-6 w-6" />
      {text}
    </div>
  );
}
