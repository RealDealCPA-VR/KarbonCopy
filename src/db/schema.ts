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
    // External email correlation (IMAP/Graph) — null for internal notes.
    externalId: text("external_id"),
    accountId: text("account_id"),
    createdAt: createdAt(),
  },
  (t) => ({ threadIdx: index("messages_thread_idx").on(t.threadId) }),
);

/* ------------------------------------------------------------------ */
/* Comments, mentions, notifications, activity (cross-entity)          */
/* ------------------------------------------------------------------ */

export type EntityKind =
  | "work_item" | "organization" | "contact" | "thread" | "document" | "time_entry"
  | "invoice" | "payment" | "deadline" | "anomaly" | "signature_request" | "setting";

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
  | "mention" | "assignment" | "file_alert" | "due_soon" | "comment" | "automator" | "system"
  | "invoice" | "payment" | "portal" | "signature" | "deadline" | "anomaly";

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

/* ================================================================== */
/* PHASE 1/2 — revenue, client-facing, compliance, integrations, AI   */
/* (frozen contract; feature agents build against these)              */
/* ================================================================== */

/* ---- Billing: invoices, lines, payments -------------------------- */

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "void" | "overdue";

export const invoices = sqliteTable(
  "invoices",
  {
    id: id(),
    number: text("number").notNull(), // human invoice no., e.g. INV-2026-0001
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    status: text("status").$type<InvoiceStatus>().notNull().default("draft"),
    issueDate: integer("issue_date", { mode: "timestamp_ms" }),
    dueDate: integer("due_date", { mode: "timestamp_ms" }),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    notes: text("notes"),
    terms: text("terms"),
    // public payment link token (client pays via the relay/portal)
    payToken: text("pay_token"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    orgIdx: index("invoices_org_idx").on(t.organizationId),
    statusIdx: index("invoices_status_idx").on(t.status),
    numberIdx: uniqueIndex("invoices_number_idx").on(t.number),
  }),
);

export const invoiceLines = sqliteTable(
  "invoice_lines",
  {
    id: id(),
    invoiceId: text("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: real("quantity").notNull().default(1),
    unitCents: integer("unit_cents").notNull().default(0),
    amountCents: integer("amount_cents").notNull().default(0),
    workItemId: text("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    // time entries rolled into this line (for invoice-from-WIP)
    timeEntryIds: text("time_entry_ids", { mode: "json" }).$type<string[]>(),
    position: integer("position").notNull().default(0),
  },
  (t) => ({ invoiceIdx: index("invoice_lines_invoice_idx").on(t.invoiceId) }),
);

export type PaymentMethod = "card" | "ach" | "check" | "cash" | "wire" | "manual";

export const payments = sqliteTable(
  "payments",
  {
    id: id(),
    invoiceId: text("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    amountCents: integer("amount_cents").notNull(),
    method: text("method").$type<PaymentMethod>().notNull().default("manual"),
    reference: text("reference"),
    processor: text("processor").$type<"stripe" | "manual" | "other">().notNull().default("manual"),
    processorRef: text("processor_ref"), // stripe payment_intent id, etc.
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ invoiceIdx: index("payments_invoice_idx").on(t.invoiceId) }),
);

/* ---- Authenticated client portal -------------------------------- */

export const portalUsers = sqliteTable(
  "portal_users",
  {
    id: id(),
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
    // one-time login / set-password token
    inviteToken: text("invite_token"),
    inviteExpiresAt: integer("invite_expires_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => ({
    emailIdx: uniqueIndex("portal_users_email_idx").on(t.email),
    contactIdx: index("portal_users_contact_idx").on(t.contactId),
  }),
);

export const portalSessions = sqliteTable("portal_sessions", {
  id: id(),
  portalUserId: text("portal_user_id").notNull().references(() => portalUsers.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
});

/* ---- E-signature (offline LAN, 8879 / engagement letters) -------- */

export type SignatureStatus = "draft" | "sent" | "viewed" | "signed" | "declined" | "expired";

export const signatureRequests = sqliteTable(
  "signature_requests",
  {
    id: id(),
    title: text("title").notNull(),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    workItemId: text("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    status: text("status").$type<SignatureStatus>().notNull().default("draft"),
    magicToken: text("magic_token").notNull(),
    message: text("message"),
    // JSON array of signature/initial/date field placements
    fields: text("fields", { mode: "json" }).$type<Array<Record<string, unknown>>>(),
    // path to the signed/stamped output PDF
    signedDocumentPath: text("signed_document_path"),
    signerName: text("signer_name"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdById: text("created_by_id").references(() => users.id),
    signedAt: integer("signed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => ({ tokenIdx: uniqueIndex("sig_token_idx").on(t.magicToken) }),
);

export const signatureEvents = sqliteTable(
  "signature_events",
  {
    id: id(),
    requestId: text("request_id").notNull().references(() => signatureRequests.id, { onDelete: "cascade" }),
    type: text("type").$type<"created" | "sent" | "viewed" | "signed" | "declined">().notNull(),
    actorName: text("actor_name"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    // tamper-evident: sha256 of (prevHash + payload)
    hash: text("hash"),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => ({ reqIdx: index("sig_events_req_idx").on(t.requestId) }),
);

/* ---- Compliance / tax-deadline calendar -------------------------- */

export type DeadlineStatus = "upcoming" | "in_progress" | "filed" | "extended" | "missed" | "na";

export const complianceDeadlines = sqliteTable(
  "compliance_deadlines",
  {
    id: id(),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // "2024 Form 1120S"
    jurisdiction: text("jurisdiction").notNull().default("federal"), // federal / state code
    form: text("form"), // 1040, 1120S, 1065, 941...
    taxPeriod: text("tax_period"), // "2024"
    dueDate: integer("due_date", { mode: "timestamp_ms" }).notNull(),
    extendedDueDate: integer("extended_due_date", { mode: "timestamp_ms" }),
    status: text("status").$type<DeadlineStatus>().notNull().default("upcoming"),
    workItemId: text("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    ruleKey: text("rule_key"), // links back to the bundled rule that generated it
    autoGenerated: integer("auto_generated", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({
    dueIdx: index("deadlines_due_idx").on(t.dueDate),
    orgIdx: index("deadlines_org_idx").on(t.organizationId),
  }),
);

/* ---- Real email (firm mailboxes) -------------------------------- */

export const emailAccounts = sqliteTable("email_accounts", {
  id: id(),
  label: text("label").notNull(),
  address: text("address").notNull(),
  provider: text("provider").$type<"smtp_imap" | "gmail" | "graph">().notNull().default("smtp_imap"),
  // encrypted JSON (host/port/user/pass or oauth tokens) via lib/crypto
  configEnc: text("config_enc"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

/* ---- On-prem document understanding (OCR/classify/extract) ------- */

export type ExtractionStatus = "pending" | "processing" | "processed" | "failed" | "matched";

export const documentExtractions = sqliteTable(
  "document_extractions",
  {
    id: id(),
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    fileEventId: text("file_event_id").references(() => fileEvents.id, { onDelete: "set null" }),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    sourcePath: text("source_path").notNull(),
    docType: text("doc_type"), // w2, 1099, k1, bank_stmt, 8879, id, unknown
    confidence: real("confidence"),
    extractedFields: text("extracted_fields", { mode: "json" }).$type<Record<string, unknown>>(),
    ocrText: text("ocr_text"),
    status: text("status").$type<ExtractionStatus>().notNull().default("pending"),
    matchedRequestId: text("matched_request_id").references(() => documentRequests.id, { onDelete: "set null" }),
    matchedWorkItemId: text("matched_work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    engine: text("engine"), // tesseract / claude / etc.
    error: text("error"),
    createdAt: createdAt(),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  },
  (t) => ({ statusIdx: index("extractions_status_idx").on(t.status) }),
);

/* ---- Books-health anomaly radar --------------------------------- */

export type AnomalyStatus = "open" | "reviewed" | "dismissed";

export const anomalies = sqliteTable(
  "anomalies",
  {
    id: id(),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    source: text("source").$type<"quickbooks" | "statement" | "manual">().notNull().default("quickbooks"),
    kind: text("kind").notNull(), // duplicate_payment, round_dollar, backdated, uncategorized_spike, reconciliation_drift
    severity: text("severity").$type<"info" | "warning" | "critical">().notNull().default("warning"),
    title: text("title").notNull(),
    detail: text("detail"),
    amountCents: integer("amount_cents"),
    status: text("status").$type<AnomalyStatus>().notNull().default("open"),
    detectedAt: integer("detected_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    reviewedById: text("reviewed_by_id").references(() => users.id),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => ({
    orgIdx: index("anomalies_org_idx").on(t.organizationId),
    statusIdx: index("anomalies_status_idx").on(t.status),
  }),
);

/* ---- Integrations (QuickBooks Desktop / Lacerte via MCP) --------- */

export const integrationConfigs = sqliteTable("integration_configs", {
  id: id(),
  kind: text("kind").$type<"quickbooks_desktop" | "quickbooks_online" | "lacerte" | "drake" | "ultratax">().notNull(),
  label: text("label").notNull(),
  // JSON: MCP server endpoint/command, watched folder paths, mapping config
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  status: text("status").$type<"ok" | "error" | "unconfigured">().notNull().default("unconfigured"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

/* ---- API keys (programmatic / agent + MCP access) --------------- */

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: id(),
    name: text("name").notNull(), // human label, e.g. "Claude Desktop"
    // the key acts AS this user (inherits their role for RBAC)
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // sha256(rawKey) — the raw key is shown once at creation, never stored
    keyHash: text("key_hash").notNull(),
    // first chars for display, e.g. "kc_live_ab12cd"
    prefix: text("prefix").notNull(),
    // optional fine-grained scopes; null = inherit the user's role
    scopes: text("scopes", { mode: "json" }).$type<string[] | null>(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({
    hashIdx: uniqueIndex("api_keys_hash_idx").on(t.keyHash),
    userIdx: index("api_keys_user_idx").on(t.userId),
  }),
);

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
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PortalUser = typeof portalUsers.$inferSelect;
export type PortalSession = typeof portalSessions.$inferSelect;
export type SignatureRequest = typeof signatureRequests.$inferSelect;
export type SignatureEvent = typeof signatureEvents.$inferSelect;
export type ComplianceDeadline = typeof complianceDeadlines.$inferSelect;
export type EmailAccount = typeof emailAccounts.$inferSelect;
export type DocumentExtraction = typeof documentExtractions.$inferSelect;
export type Anomaly = typeof anomalies.$inferSelect;
export type IntegrationConfig = typeof integrationConfigs.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
