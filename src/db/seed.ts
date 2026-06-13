/**
 * Seed KarbonCopy with a realistic demo firm.
 * Run after `pnpm db:push`:  pnpm db:seed
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db, schema } from "./index";
import { hashPassword } from "../lib/password";
import { nanoid } from "nanoid";

async function main() {
  console.log("Seeding KarbonCopy…");

  // ---- users ----
  const [owner] = await db
    .insert(schema.users)
    .values({
      name: "Avery Stone",
      email: "admin@firm.com",
      passwordHash: hashPassword("admin123"),
      role: "owner",
      title: "Managing Partner",
      color: "#3b82f6",
    })
    .returning();

  const staff = await db
    .insert(schema.users)
    .values([
      { name: "Jordan Lee", email: "jordan@firm.com", passwordHash: hashPassword("staff123"), role: "manager", title: "Tax Manager", color: "#22c55e" },
      { name: "Sam Rivera", email: "sam@firm.com", passwordHash: hashPassword("staff123"), role: "staff", title: "Senior Accountant", color: "#f97316" },
      { name: "Priya Nair", email: "priya@firm.com", passwordHash: hashPassword("staff123"), role: "staff", title: "Bookkeeper", color: "#8b5cf6" },
    ])
    .returning();

  // ---- work statuses ----
  const statuses = await db
    .insert(schema.workStatuses)
    .values([
      { name: "To Start", category: "todo", position: 0, color: "#94a3b8", isDefault: true },
      { name: "In Progress", category: "in_progress", position: 1, color: "#3b82f6" },
      { name: "Waiting on Client", category: "waiting", position: 2, color: "#f59e0b" },
      { name: "Review", category: "review", position: 3, color: "#8b5cf6" },
      { name: "Complete", category: "done", position: 4, color: "#22c55e" },
    ])
    .returning();
  const S = (n: string) => statuses.find((s) => s.name === n)!;

  // ---- work types ----
  const types = await db
    .insert(schema.workTypes)
    .values([
      { name: "1040 Individual", color: "#3b82f6", defaultBudgetMinutes: 240 },
      { name: "1120S S-Corp", color: "#8b5cf6", defaultBudgetMinutes: 480 },
      { name: "Monthly Bookkeeping", color: "#22c55e", defaultBudgetMinutes: 180 },
      { name: "Payroll", color: "#f97316", defaultBudgetMinutes: 90 },
    ])
    .returning();
  const T = (n: string) => types.find((t) => t.name.startsWith(n))!;

  // ---- clients ----
  const orgs = await db
    .insert(schema.organizations)
    .values([
      { name: "Acme Manufacturing LLC", entityType: "llc", ownerId: owner.id, fiscalYearEnd: "12-31" },
      { name: "Bright Cafe Inc", entityType: "s_corp", ownerId: staff[0].id, fiscalYearEnd: "12-31" },
      { name: "Sunrise Dental PC", entityType: "c_corp", ownerId: staff[0].id, fiscalYearEnd: "06-30" },
      { name: "Green Valley Farms", entityType: "partnership", ownerId: owner.id, fiscalYearEnd: "12-31" },
      { name: "Coastal Realty Group", entityType: "llc", ownerId: staff[1].id, fiscalYearEnd: "12-31" },
    ])
    .returning();

  await db.insert(schema.contacts).values([
    { firstName: "John", lastName: "Acme", email: "john@acme.com", organizationId: orgs[0].id, isPrimary: true, ownerId: owner.id },
    { firstName: "Maria", lastName: "Bright", email: "maria@brightcafe.com", organizationId: orgs[1].id, isPrimary: true, ownerId: staff[0].id },
    { firstName: "Dr. Susan", lastName: "Kim", email: "susan@sunrisedental.com", organizationId: orgs[2].id, isPrimary: true, ownerId: staff[0].id },
  ]);

  // ---- work items ----
  const day = 86400_000;
  const now = Date.now();
  const assignees = [owner.id, ...staff.map((s) => s.id)];
  const wiValues = [
    { title: "2024 Form 1040 — Acme Owner", typeKey: "1040", org: 0, status: "In Progress", due: now + 5 * day, assignee: 2 },
    { title: "Q2 Bookkeeping — Bright Cafe", typeKey: "Monthly", org: 1, status: "To Start", due: now + 2 * day, assignee: 3 },
    { title: "2024 1120S — Bright Cafe", typeKey: "1120S", org: 1, status: "Review", due: now - 1 * day, assignee: 1 },
    { title: "Payroll Setup — Sunrise Dental", typeKey: "Payroll", org: 2, status: "Waiting on Client", due: now + 10 * day, assignee: 2 },
    { title: "2024 1065 — Green Valley Farms", typeKey: "1120S", org: 3, status: "To Start", due: now + 14 * day, assignee: 0 },
    { title: "Monthly Close — Coastal Realty", typeKey: "Monthly", org: 4, status: "In Progress", due: now - 3 * day, assignee: 3 },
  ];
  const workItems = await db
    .insert(schema.workItems)
    .values(
      wiValues.map((w, i) => ({
        title: w.title,
        workTypeId: T(w.typeKey).id,
        statusId: S(w.status).id,
        organizationId: orgs[w.org].id,
        assigneeId: assignees[w.assignee],
        dueDate: new Date(w.due),
        budgetMinutes: T(w.typeKey).defaultBudgetMinutes ?? 120,
        boardPosition: i,
        priority: (w.due < now ? "high" : "normal") as "high" | "normal",
      })),
    )
    .returning();

  // tasks for the first work item
  await db.insert(schema.workTasks).values([
    { workItemId: workItems[0].id, title: "Collect W-2s and 1099s", section: "Gather", position: 0, completed: true, completedAt: new Date() },
    { workItemId: workItems[0].id, title: "Enter income", section: "Prepare", position: 1 },
    { workItemId: workItems[0].id, title: "Review deductions", section: "Prepare", position: 2 },
    { workItemId: workItems[0].id, title: "Partner review", section: "Review", position: 3 },
    { workItemId: workItems[0].id, title: "E-file", section: "File", position: 4 },
  ]);

  // ---- file watcher demo config (disabled by default; point WATCH_ROOTS or edit in Settings) ----
  const [root] = await db
    .insert(schema.watchedRoots)
    .values({ label: "Client Returns Share", path: "./data/watch-demo", enabled: false })
    .returning();
  await db.insert(schema.fileRules).values([
    {
      rootId: root.id,
      name: "Return marked complete",
      globPattern: "**/Completed/**",
      event: "add",
      notify: "all",
      message: "✅ {file} completed for {client}",
      severity: "success",
    },
    {
      rootId: root.id,
      name: "Ready for review",
      globPattern: "**/*_FINAL.*",
      event: "add",
      notify: "owner",
      message: "{file} is ready for review",
      severity: "info",
    },
  ]);

  // ---- demo triage thread ----
  const [thread] = await db
    .insert(schema.inboxThreads)
    .values({
      subject: "Question about my Q2 estimate",
      status: "open",
      organizationId: orgs[0].id,
      lastMessageAt: new Date(),
    })
    .returning();
  await db.insert(schema.messages).values({
    threadId: thread.id,
    fromName: "John Acme",
    fromEmail: "john@acme.com",
    body: "Hi — can you confirm my Q2 estimated payment amount and due date? Thanks!",
    direction: "inbound",
  });

  // ---- demo client-portal document request ----
  await db.insert(schema.documentRequests).values({
    title: "2024 Tax Documents",
    message: "Please upload the following so we can prepare your return.",
    organizationId: orgs[0].id,
    createdById: owner.id,
    magicToken: nanoid(32),
    expiresAt: new Date(Date.now() + 30 * day),
    status: "open",
    items: [
      { label: "W-2 / 1099 forms", fulfilled: false },
      { label: "Prior year return", fulfilled: false },
      { label: "Mortgage interest (1098)", fulfilled: false },
    ],
  });

  // ---- a sample notification so the UI isn't empty ----
  await db.insert(schema.notifications).values({
    userId: owner.id,
    type: "system",
    title: "Welcome to KarbonCopy",
    body: "Your firm workspace is ready. Configure watched folders in Settings.",
  });

  console.log("✓ Seed complete.");
  console.log("  Login: admin@firm.com / admin123");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
