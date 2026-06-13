/**
 * KarbonCopy — database schema (SQLite / Drizzle)
 *
 * This is the FROZEN shared contract that every feature module builds against.
 * Schema changes must go through the main coordinator, not individual feature agents.
 *
 * Conventions:
 *  - ids: text (nanoid), generated app-side via createId()
 *  - timestamps: integer unix-ms (mode "timestamp_ms")
 *  - money: integer cents
 *  - enums: text with $type<...> for compile-time safety
 *  - soft-delete via deletedAt where relevant
 */
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";

export const createId = () => nanoid(16);

const id = () =>
  text("id").primaryKey().$defaultFn(createId);
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date());
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date());

/* ------------------------------------------------------------------ */
/* Auth & people (firm staff)                                          */
/* ------------------------------------------------------------------ */

export type UserRole = "owner" | "admin" | "manager" | "staff" | "readonly";

export const users = sqliteTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    image: text("image"),
    role: text("role").$type<UserRole>().notNull().default("staff"),
    title: text("title"), // job title
    teamId: text("team_id"),
    // hours/week capacity for the workload heatmap
    weeklyCapacityMinutes: integer("weekly_capacity_minutes").notNull().default(2400),
    color: text("color"), // avatar accent
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ emailIdx: uniqueIndex("users_email_idx").on(t.email) }),
);

export const teams = sqliteTable("teams", {
  id: id(),
  name: text("name").notNull(),
  color: text("color"),
  createdAt: createdAt(),
});

// Auth.js sessions (database strategy fallback / API tokens)
export const sessions = sqliteTable("sessions", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* CRM — contacts, organizations, client groups                        */
/* ------------------------------------------------------------------ */

export type EntityType =
  | "individual" | "sole_prop" | "partnership" | "s_corp" | "c_corp"
  | "llc" | "nonprofit" | "trust" | "estate" | "other";

export const organizations = sqliteTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    entityType: text("entity_type").$type<EntityType>().notNull().default("c_corp"),
    ein: text("ein"), // stored masked/encrypted at app layer
    website: text("website"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    fiscalYearEnd: text("fiscal_year_end"), // MM-DD
    notes: text("notes"),
    ownerId: text("owner_id").references(() => users.id), // relationship manager
    clientGroupId: text("client_group_id"),
    isClient: integer("is_client", { mode: "boolean" }).notNull().default(true),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ nameIdx: index("orgs_name_idx").on(t.name) }),
);

export const contacts = sqliteTable(
  "contacts",
  {
    id: id(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    ssnLast4: text("ssn_last4"),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    portalEnabled: integer("portal_enabled", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),
    ownerId: text("owner_id").references(() => users.id),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    nameIdx: index("contacts_name_idx").on(t.lastName, t.firstName),
    orgIdx: index("contacts_org_idx").on(t.organizationId),
  }),
);

export const clientGroups = sqliteTable("client_groups", {
  id: id(),
  name: text("name").notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Work management                                                     */
/* ------------------------------------------------------------------ */

export const workTypes = sqliteTable("work_types", {
  id: id(),
  name: text("name").notNull(), // "1040", "1120S", "Monthly Bookkeeping", "Payroll"
  color: text("color"),
  defaultBudgetMinutes: integer("default_budget_minutes"),
  createdAt: createdAt(),
});

export type WorkStatusCategory = "todo" | "in_progress" | "waiting" | "review" | "done";

export const workStatuses = sqliteTable("work_statuses", {
  id: id(),
  name: text("name").notNull(), // "To Start", "In Progress", "Waiting on Client", "Review", "Complete"
  category: text("category").$type<WorkStatusCategory>().notNull().default("todo"),
  position: integer("position").notNull().default(0),
  color: text("color"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
});

export type WorkPriority = "low" | "normal" | "high" | "urgent";

export const workItems = sqliteTable(
  "work_items",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description"),
    workTypeId: text("work_type_id").references(() => workTypes.id),
    statusId: text("status_id").references(() => workStatuses.id),
    priority: text("priority").$type<WorkPriority>().notNull().default("normal"),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    assigneeId: text("assignee_id").references(() => users.id),
    teamId: text("team_id").references(() => teams.id),
    startDate: integer("start_date", { mode: "timestamp_ms" }),
    dueDate: integer("due_date", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    budgetMinutes: integer("budget_minutes"),
    budgetAmountCents: integer("budget_amount_cents"),
    boardPosition: real("board_position").notNull().default(0),
    // recurrence: null = one-off, else iCal-ish rule string
    recurrenceRule: text("recurrence_rule"),
    templateId: text("template_id"),
    // link to a file-server folder for this engagement
    fileFolderPath: text("file_folder_path"),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    statusIdx: index("work_status_idx").on(t.statusId),
    assigneeIdx: index("work_assignee_idx").on(t.assigneeId),
    orgIdx: index("work_org_idx").on(t.organizationId),
    dueIdx: index("work_due_idx").on(t.dueDate),
  }),
);

export const workTasks = sqliteTable(
  "work_tasks",
  {
    id: id(),
    workItemId: text("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    section: text("section"), // group checklist items
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    completedById: text("completed_by_id").references(() => users.id),
    assigneeId: text("assignee_id").references(() => users.id),
    dueDate: integer("due_date", { mode: "timestamp_ms" }),
    dependsOnId: text("depends_on_id"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => ({ workIdx: index("tasks_work_idx").on(t.workItemId) }),
);

export const workTemplates = sqliteTable("work_templates", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  workTypeId: text("work_type_id").references(() => workTypes.id),
  defaultBudgetMinutes: integer("default_budget_minutes"),
  recurrenceRule: text("recurrence_rule"),
  createdAt: createdAt(),
});

export const templateTasks = sqliteTable("template_tasks", {
  id: id(),
  templateId: text("template_id").notNull().references(() => workTemplates.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  section: text("section"),
  position: integer("position").notNull().default(0),
  // offset days from work start for the task due date
  dueOffsetDays: integer("due_offset_days"),
});

/* ------------------------------------------------------------------ */
/* Automators (rules engine)                                           */
/* ------------------------------------------------------------------ */

export type AutomatorTrigger =
  | "status_changed" | "work_created" | "task_completed"
  | "due_approaching" | "file_event" | "all_tasks_done";
export type AutomatorAction =
  | "set_status" | "assign" | "notify" | "create_task" | "send_email" | "create_work";

export const automators = sqliteTable("automators", {
  id: id(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  trigger: text("trigger").$type<AutomatorTrigger>().notNull(),
  // JSON: trigger conditions (e.g. { fromStatusId, toStatusId, workTypeId })
  conditions: text("conditions", { mode: "json" }).$type<Record<string, unknown>>(),
  action: text("action").$type<AutomatorAction>().notNull(),
  // JSON: action params (e.g. { statusId, assigneeId, message })
  actionParams: text("action_params", { mode: "json" }).$type<Record<string, unknown>>(),
  runCount: integer("run_count").notNull().default(0),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Time & budgets                                                      */
/* ------------------------------------------------------------------ */

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    description: text("description"),
    minutes: integer("minutes").notNull().default(0),
    billable: integer("billable", { mode: "boolean" }).notNull().default(true),
    rateCents: integer("rate_cents"),
    date: integer("date", { mode: "timestamp_ms" }).notNull(),
    // running timer support
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    running: integer("running", { mode: "boolean" }).notNull().default(false),
    approved: integer("approved", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({
    userDateIdx: index("time_user_date_idx").on(t.userId, t.date),
    workIdx: index("time_work_idx").on(t.workItemId),
  }),
);

/* ------------------------------------------------------------------ */
/* Documents & client portal                                           */
/* ------------------------------------------------------------------ */

export const folders = sqliteTable("folders", {
  id: id(),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const documents = sqliteTable(
  "documents",
  {
    id: id(),
    name: text("name").notNull(),
    folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    workItemId: text("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    // stored relative to the data/uploads dir OR a UNC path on the file server
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    version: integer("version").notNull().default(1),
    uploadedById: text("uploaded_by_id").references(() => users.id),
    source: text("source").$type<"upload" | "portal" | "fileserver">().notNull().default("upload"),
    createdAt: createdAt(),
  },
  (t) => ({ orgIdx: index("docs_org_idx").on(t.organizationId) }),
);

export type RequestStatus = "open" | "partial" | "fulfilled" | "expired";

export const documentRequests = sqliteTable("document_requests", {
  id: id(),
  title: text("title").notNull(),
  message: text("message"),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  workItemId: text("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
  // JSON array of requested items [{ label, fulfilled, documentId }]
  items: text("items", { mode: "json" }).$type<Array<{ label: string; fulfilled: boolean; documentId?: string }>>(),
  status: text("status").$type<RequestStatus>().notNull().default("open"),
  magicToken: text("magic_token").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  createdById: text("created_by_id").references(() => users.id),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Triage / shared inbox                                               */
/* ------------------------------------------------------------------ */

export type ThreadStatus = "open" | "assigned" | "waiting" | "closed";

export const inboxThreads = sqliteTable("inbox_threads", {
  id: id(),
  subject: text("subject").notNull(),
  status: text("status").$type<ThreadStatus>().notNull().default("open"),
  assigneeId: text("assignee_id").references(() => users.id),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  workItemId: text("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
  lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: id(),
    threadId: text("thread_id").notNull().references(() => inboxThreads.id, { onDelete: "cascade" }),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    toEmail: text("to_email"),
    body: text("body").notNull(),
    direction: text("direction").$type<"inbound" | "outbound" | "note">().notNull().default("inbound"),
    sentById: text("sent_by_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ threadIdx: index("messages_thread_idx").on(t.threadId) }),
);

/* ------------------------------------------------------------------ */
/* Comments, mentions, notifications, activity (cross-entity)          */
/* ------------------------------------------------------------------ */

export type EntityKind =
  | "work_item" | "organization" | "contact" | "thread" | "document" | "time_entry";

export const comments = sqliteTable(
  "comments",
  {
    id: id(),
    entityKind: text("entity_kind").$type<EntityKind>().notNull(),
    entityId: text("entity_id").notNull(),
    authorId: text("author_id").notNull().references(() => users.id),
    body: text("body").notNull(),
    // JSON array of mentioned user ids
    mentions: text("mentions", { mode: "json" }).$type<string[]>(),
    createdAt: createdAt(),
  },
  (t) => ({ entityIdx: index("comments_entity_idx").on(t.entityKind, t.entityId) }),
);

export type NotificationType =
  | "mention" | "assignment" | "file_alert" | "due_soon" | "comment" | "automator" | "system";

export const notifications = sqliteTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    title: text("title").notNull(),
    body: text("body"),
    // deep-link target
    entityKind: text("entity_kind").$type<EntityKind>(),
    entityId: text("entity_id"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({ userReadIdx: index("notif_user_read_idx").on(t.userId, t.read) }),
);

export const activities = sqliteTable(
  "activities",
  {
    id: id(),
    actorId: text("actor_id").references(() => users.id),
    verb: text("verb").notNull(), // "created", "updated", "completed", "assigned", "uploaded"
    entityKind: text("entity_kind").$type<EntityKind>().notNull(),
    entityId: text("entity_id").notNull(),
    // human summary + JSON metadata
    summary: text("summary").notNull(),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => ({ entityIdx: index("activities_entity_idx").on(t.entityKind, t.entityId) }),
);

/* ------------------------------------------------------------------ */
/* ⭐ File-server completion alerts (the differentiator)               */
/* ------------------------------------------------------------------ */

export const watchedRoots = sqliteTable("watched_roots", {
  id: id(),
  label: text("label").notNull(), // "Client Returns Share"
  path: text("path").notNull(), // \\FILESERVER\Clients
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // map a path segment to a client by name (for auto-linking)
  matchOrgByFolder: integer("match_org_by_folder", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

export type FileRuleEvent = "add" | "change" | "unlink" | "addDir";

export const fileRules = sqliteTable("file_rules", {
  id: id(),
  rootId: text("root_id").notNull().references(() => watchedRoots.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // "Return marked complete"
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // glob relative to root, e.g. **/Completed/**, **/*_FINAL.pdf
  globPattern: text("glob_pattern").notNull(),
  event: text("event").$type<FileRuleEvent>().notNull().default("add"),
  // who gets notified: JSON user ids, or "owner" / "assignee" / "all"
  notify: text("notify", { mode: "json" }).$type<string[] | string>(),
  message: text("message"), // template, supports {file} {client} {folder}
  severity: text("severity").$type<"info" | "success" | "warning">().notNull().default("success"),
  createdAt: createdAt(),
});

export type FileEventStatus = "new" | "acknowledged" | "dismissed";

export const fileEvents = sqliteTable(
  "file_events",
  {
    id: id(),
    rootId: text("root_id").references(() => watchedRoots.id, { onDelete: "set null" }),
    ruleId: text("rule_id").references(() => fileRules.id, { onDelete: "set null" }),
    event: text("event").$type<FileRuleEvent>().notNull(),
    filePath: text("file_path").notNull(),
    fileName: text("file_name").notNull(),
    sizeBytes: integer("size_bytes"),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    workItemId: text("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    status: text("status").$type<FileEventStatus>().notNull().default("new"),
    acknowledgedById: text("acknowledged_by_id").references(() => users.id),
    acknowledgedAt: integer("acknowledged_at", { mode: "timestamp_ms" }),
    detectedAt: integer("detected_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    statusIdx: index("file_events_status_idx").on(t.status),
    detectedIdx: index("file_events_detected_idx").on(t.detectedAt),
  }),
);

/* ------------------------------------------------------------------ */
/* Tags & custom fields                                                */
/* ------------------------------------------------------------------ */

export const tags = sqliteTable("tags", {
  id: id(),
  name: text("name").notNull(),
  color: text("color"),
});

export const entityTags = sqliteTable(
  "entity_tags",
  {
    id: id(),
    tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
    entityKind: text("entity_kind").$type<EntityKind>().notNull(),
    entityId: text("entity_id").notNull(),
  },
  (t) => ({ entityIdx: index("entity_tags_idx").on(t.entityKind, t.entityId) }),
);

export const customFields = sqliteTable("custom_fields", {
  id: id(),
  entityKind: text("entity_kind").$type<EntityKind>().notNull(),
  label: text("label").notNull(),
  fieldType: text("field_type").$type<"text" | "number" | "date" | "select" | "boolean">().notNull().default("text"),
  options: text("options", { mode: "json" }).$type<string[]>(),
  position: integer("position").notNull().default(0),
});

export const customFieldValues = sqliteTable(
  "custom_field_values",
  {
    id: id(),
    fieldId: text("field_id").notNull().references(() => customFields.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(),
    value: text("value"),
  },
  (t) => ({ fieldEntityIdx: uniqueIndex("cfv_field_entity_idx").on(t.fieldId, t.entityId) }),
);

/* ------------------------------------------------------------------ */
/* App settings (key/value)                                            */
/* ------------------------------------------------------------------ */

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Type exports for the app layer                                      */
/* ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type WorkItem = typeof workItems.$inferSelect;
export type NewWorkItem = typeof workItems.$inferInsert;
export type WorkTask = typeof workTasks.$inferSelect;
export type WorkStatus = typeof workStatuses.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentRequest = typeof documentRequests.$inferSelect;
export type InboxThread = typeof inboxThreads.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type WatchedRoot = typeof watchedRoots.$inferSelect;
export type FileRule = typeof fileRules.$inferSelect;
export type FileEvent = typeof fileEvents.$inferSelect;
export type Automator = typeof automators.$inferSelect;
export type Tag = typeof tags.$inferSelect;
