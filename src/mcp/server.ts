/**
 * KarbonCopy MCP server.
 *
 * A standalone, stdio-based Model Context Protocol server that lets Claude
 * Desktop / Claude Code enter and query everything in KarbonCopy via tools.
 *
 * It runs OUTSIDE Next.js (under tsconfig.server.json, where `server-only` is
 * stubbed) and talks to the SAME local SQLite database as the running app via
 * its own better-sqlite3 connection. SQLite WAL mode makes this safe alongside
 * the live app on :3000.
 *
 * Architecture: ONE shared, pure service layer (src/lib/api/services/*). Every
 * service fn takes an explicit `actor` (the API key's user), enforces RBAC,
 * validates with zod, and throws `ApiError`. This process never imports any
 * Next-only / server-only code that isn't stubbed.
 *
 * Auth: read `process.env.KARBONCOPY_API_KEY` and resolve it ONCE at startup to
 * an actor. The server still starts when the key is absent/invalid (so
 * `tools/list` works for discovery) — but every tool then returns a clear auth
 * error telling the operator to set KARBONCOPY_API_KEY.
 */

// Load env FIRST, exactly like server.ts — before any module that reads
// process.env at import time (db path, crypto key, …).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { resolveActorFromKey, type ApiActor } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";

import * as organizations from "@/lib/api/services/organizations";
import * as contacts from "@/lib/api/services/contacts";
import * as work from "@/lib/api/services/work";
import * as time from "@/lib/api/services/time";
import * as billing from "@/lib/api/services/billing";
import * as deadlines from "@/lib/api/services/deadlines";
import * as reference from "@/lib/api/services/reference";
import * as searchSvc from "@/lib/api/services/search";

/* --------------------------------------------------------------------------
 * JSON-schema fragments (kept small + composable)
 * ------------------------------------------------------------------------ */

type JsonSchema = Tool["inputSchema"];

const NONE: JsonSchema = { type: "object", properties: {}, additionalProperties: false };

const idSchema = (what: string): JsonSchema => ({
  type: "object",
  properties: { id: { type: "string", description: `The ${what} id` } },
  required: ["id"],
  additionalProperties: false,
});

const pagination = {
  limit: { type: "number", description: "Max rows (1-200, default 50)" },
  offset: { type: "number", description: "Rows to skip (default 0)" },
  search: { type: "string", description: "Case-insensitive name/title filter" },
} as const;

const dateField = {
  description: "ISO 8601 date string (e.g. 2024-01-15 or 2024-01-15T10:30:00Z) or epoch milliseconds",
} as const;

/* --------------------------------------------------------------------------
 * Tool registry — one entry per high-value service fn. Each handler receives
 * the resolved actor + the already-parsed args object (defaults to {}).
 * Returning a plain value -> serialized to JSON text. Throwing ApiError ->
 * isError result. Throwing anything else -> generic internal error.
 * ------------------------------------------------------------------------ */

interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (actor: ApiActor, args: Record<string, unknown>) => Promise<unknown>;
}

const str = (description: string) => ({ type: "string", description }) as const;
const bool = (description: string) => ({ type: "boolean", description }) as const;
const num = (description: string) => ({ type: "number", description }) as const;

const tools: ToolDef[] = [
  /* ----------------------------- clients (organizations) ----------------- */
  {
    name: "list_clients",
    description: "List clients (organizations). Supports limit/offset/search.",
    inputSchema: { type: "object", properties: { ...pagination }, additionalProperties: false },
    handler: (actor, a) => organizations.listOrganizations(actor, a),
  },
  {
    name: "get_client",
    description: "Get a single client (organization) by id.",
    inputSchema: idSchema("client (organization)"),
    handler: (actor, a) => organizations.getOrganization(actor, String(a.id)),
  },
  {
    name: "create_client",
    description:
      "Create a client (organization). Requires staff role or higher. Money fields n/a.",
    inputSchema: {
      type: "object",
      properties: {
        name: str("Client / organization name (required)"),
        entityType: str(
          "One of: individual, sole_prop, partnership, s_corp, c_corp, llc, nonprofit, trust, estate, other (default c_corp)",
        ),
        ein: str("EIN / tax id (encrypted at rest; managers+ see cleartext)"),
        email: str("Primary email"),
        phone: str("Phone"),
        website: str("Website URL"),
        address: str("Mailing address"),
        fiscalYearEnd: str("Fiscal year end as MM-DD"),
        notes: str("Free-form notes"),
        ownerId: str("Owning user id (see list_reference users)"),
        isClient: bool("Whether this org is a billable client (default true)"),
      },
      required: ["name"],
      additionalProperties: false,
    },
    handler: (actor, a) => organizations.createOrganization(actor, a),
  },
  {
    name: "update_client",
    description: "Update a client (organization) by id. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Client (organization) id (required)"),
        name: str("Client name"),
        entityType: str("Entity type (see create_client)"),
        ein: str("EIN / tax id"),
        email: str("Primary email"),
        phone: str("Phone"),
        website: str("Website URL"),
        address: str("Mailing address"),
        fiscalYearEnd: str("Fiscal year end MM-DD"),
        notes: str("Notes"),
        ownerId: str("Owning user id"),
        isClient: bool("Billable client flag"),
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: (actor, a) => {
      const { id, ...patch } = a;
      return organizations.updateOrganization(actor, String(id), patch);
    },
  },
  {
    name: "delete_client",
    description: "Delete (archive) a client (organization) by id. Requires manager role or higher.",
    inputSchema: idSchema("client (organization)"),
    handler: (actor, a) => organizations.archiveOrganization(actor, String(a.id)),
  },

  /* ----------------------------- contacts -------------------------------- */
  {
    name: "list_contacts",
    description: "List contacts. Optionally filter by organizationId.",
    inputSchema: {
      type: "object",
      properties: {
        ...pagination,
        organizationId: str("Filter contacts to this organization (client) id"),
      },
      additionalProperties: false,
    },
    handler: (actor, a) => contacts.listContacts(actor, a),
  },
  {
    name: "create_contact",
    description: "Create a contact. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        firstName: str("First name (required)"),
        lastName: str("Last name (required)"),
        email: str("Email"),
        phone: str("Phone"),
        title: str("Job title"),
        organizationId: str("Linked organization (client) id"),
        isPrimary: bool("Primary contact for the organization (default false)"),
        portalEnabled: bool("Client-portal access (default false)"),
        notes: str("Notes"),
        ownerId: str("Owning user id"),
      },
      required: ["firstName", "lastName"],
      additionalProperties: false,
    },
    handler: (actor, a) => contacts.createContact(actor, a),
  },
  {
    name: "get_contact",
    description: "Get a single contact by id.",
    inputSchema: idSchema("contact"),
    handler: (actor, a) => contacts.getContact(actor, String(a.id)),
  },
  {
    name: "update_contact",
    description: "Update a contact by id. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Contact id (required)"),
        firstName: str("First name"),
        lastName: str("Last name"),
        email: str("Email"),
        phone: str("Phone"),
        title: str("Job title"),
        organizationId: str("Linked organization (client) id"),
        isPrimary: bool("Primary contact for the organization"),
        portalEnabled: bool("Client-portal access"),
        notes: str("Notes"),
        ownerId: str("Owning user id"),
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: (actor, a) => {
      const { id, ...patch } = a;
      return contacts.updateContact(actor, String(id), patch);
    },
  },
  {
    name: "delete_contact",
    description: "Delete (archive) a contact by id. Requires manager role or higher.",
    inputSchema: idSchema("contact"),
    handler: (actor, a) => contacts.deleteContact(actor, String(a.id)),
  },

  /* ----------------------------- work ------------------------------------ */
  {
    name: "list_work",
    description:
      "List work items. Optionally filter by organizationId, assigneeId, statusId.",
    inputSchema: {
      type: "object",
      properties: {
        ...pagination,
        organizationId: str("Filter to this organization (client) id"),
        assigneeId: str("Filter to this assignee user id"),
        statusId: str("Filter to this work-status id (see list_reference)"),
      },
      additionalProperties: false,
    },
    handler: (actor, a) => work.listWorkItems(actor, a),
  },
  {
    name: "get_work",
    description: "Get a single work item by id.",
    inputSchema: idSchema("work item"),
    handler: (actor, a) => work.getWorkItem(actor, String(a.id)),
  },
  {
    name: "create_work",
    description: "Create a work item. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("Work item title (required)"),
        description: str("Description"),
        workTypeId: str("Work type id (see list_reference)"),
        statusId: str("Work status id (see list_reference)"),
        organizationId: str("Client (organization) id"),
        contactId: str("Linked contact id"),
        assigneeId: str("Assignee user id"),
        priority: str("One of: low, normal, high, urgent (default normal)"),
        startDate: { ...dateField, description: "Start date — " + dateField.description },
        dueDate: { ...dateField, description: "Due date — " + dateField.description },
        budgetMinutes: num("Budgeted minutes"),
      },
      required: ["title"],
      additionalProperties: false,
    },
    handler: (actor, a) => work.createWorkItem(actor, a),
  },
  {
    name: "update_work",
    description: "Update a work item by id. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Work item id (required)"),
        title: str("Work item title"),
        description: str("Description"),
        workTypeId: str("Work type id (see list_reference)"),
        statusId: str("Work status id (see list_reference)"),
        organizationId: str("Client (organization) id"),
        contactId: str("Linked contact id"),
        assigneeId: str("Assignee user id"),
        priority: str("One of: low, normal, high, urgent"),
        startDate: { ...dateField, description: "Start date — " + dateField.description },
        dueDate: { ...dateField, description: "Due date — " + dateField.description },
        budgetMinutes: num("Budgeted minutes"),
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: (actor, a) => {
      const { id, ...patch } = a;
      return work.updateWorkItem(actor, String(id), patch);
    },
  },
  {
    name: "complete_work",
    description: "Mark a work item complete. Requires staff role or higher.",
    inputSchema: idSchema("work item"),
    handler: (actor, a) => work.completeWorkItem(actor, String(a.id)),
  },
  {
    name: "add_task",
    description: "Add a checklist task to a work item. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: str("Parent work item id (required)"),
        title: str("Task title (required)"),
        section: str("Optional grouping section"),
        assigneeId: str("Assignee user id"),
        dueDate: { ...dateField, description: "Task due date — " + dateField.description },
      },
      required: ["workItemId", "title"],
      additionalProperties: false,
    },
    handler: (actor, a) => {
      const { workItemId, ...rest } = a;
      return work.addTask(actor, String(workItemId), rest);
    },
  },
  {
    name: "toggle_task",
    description:
      "Mark a checklist task completed or reopened. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: str("Task id (required)"),
        completed: bool("true = complete, false = reopen (required)"),
      },
      required: ["taskId", "completed"],
      additionalProperties: false,
    },
    handler: (actor, a) => work.toggleTask(actor, String(a.taskId), Boolean(a.completed)),
  },
  {
    name: "list_tasks",
    description: "List the checklist tasks for a work item.",
    inputSchema: {
      type: "object",
      properties: { workItemId: str("Parent work item id (required)") },
      required: ["workItemId"],
      additionalProperties: false,
    },
    handler: (actor, a) => work.listTasks(actor, String(a.workItemId)),
  },

  /* ----------------------------- time ------------------------------------ */
  {
    name: "log_time",
    description:
      "Log a time entry. userId defaults to the acting user. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        minutes: num("Minutes worked (required, integer >= 0)"),
        date: { ...dateField, description: "Date of the work (required) — " + dateField.description },
        userId: str("User id (defaults to the API key's user)"),
        workItemId: str("Work item id this time is against"),
        billable: bool("Billable (default true)"),
        description: str("What was done"),
        rateCents: num("Billing rate in integer cents"),
      },
      required: ["minutes", "date"],
      additionalProperties: false,
    },
    handler: (actor, a) => time.createTimeEntry(actor, a),
  },
  {
    name: "list_time",
    description: "List time entries. Optionally filter by userId or workItemId.",
    inputSchema: {
      type: "object",
      properties: {
        ...pagination,
        userId: str("Filter to this user id"),
        workItemId: str("Filter to this work item id"),
      },
      additionalProperties: false,
    },
    handler: (actor, a) => time.listTimeEntries(actor, a),
  },
  {
    name: "update_time",
    description: "Update a time entry by id. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Time entry id (required)"),
        minutes: num("Minutes worked (integer >= 0)"),
        date: { ...dateField, description: "Date of the work — " + dateField.description },
        workItemId: str("Work item id this time is against"),
        billable: bool("Billable"),
        description: str("What was done"),
        rateCents: num("Billing rate in integer cents"),
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: (actor, a) => {
      const { id, ...patch } = a;
      return time.updateTimeEntry(actor, String(id), patch);
    },
  },
  {
    name: "delete_time",
    description: "Delete a time entry by id. Requires manager role or higher.",
    inputSchema: idSchema("time entry"),
    handler: (actor, a) => time.deleteTimeEntry(actor, String(a.id)),
  },

  /* ----------------------------- billing --------------------------------- */
  {
    name: "list_invoices",
    description: "List invoices. Optionally filter by organizationId or status.",
    inputSchema: {
      type: "object",
      properties: {
        ...pagination,
        organizationId: str("Filter to this organization (client) id"),
        status: str("One of: draft, sent, partial, paid, void, overdue"),
      },
      additionalProperties: false,
    },
    handler: (actor, a) => billing.listInvoices(actor, a),
  },
  {
    name: "get_invoice",
    description: "Get a single invoice (with its line items) by id.",
    inputSchema: idSchema("invoice"),
    handler: (actor, a) => billing.getInvoice(actor, String(a.id)),
  },
  {
    name: "create_invoice",
    description:
      "Create an invoice. Totals + sequential number computed server-side. Money in integer cents. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: str("Client (organization) id (required)"),
        contactId: str("Bill-to contact id (optional)"),
        issueDate: { ...dateField, description: "Issue date — " + dateField.description },
        dueDate: { ...dateField, description: "Due date — " + dateField.description },
        lines: {
          type: "array",
          description: "Invoice line items (required, at least one)",
          items: {
            type: "object",
            properties: {
              description: str("Line description (required)"),
              quantity: num("Quantity (default 1)"),
              unitCents: num("Unit price in integer cents (required)"),
            },
            required: ["description", "unitCents"],
            additionalProperties: false,
          },
        },
        taxBps: num("Tax in basis points, e.g. 825 = 8.25% (default 0)"),
        discountCents: num("Discount in integer cents (default 0)"),
        notes: str("Notes"),
        terms: str("Payment terms"),
      },
      required: ["organizationId", "lines"],
      additionalProperties: false,
    },
    handler: (actor, a) => billing.createInvoice(actor, a),
  },
  {
    name: "record_payment",
    description:
      "Record a payment against an invoice; recomputes invoice status. Money in integer cents. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: str("Invoice id (required)"),
        amountCents: num("Amount in integer cents (required, >= 1)"),
        method: str("One of: card, ach, check, cash, wire, manual (default manual)"),
        reference: str("Payment reference / memo"),
      },
      required: ["invoiceId", "amountCents"],
      additionalProperties: false,
    },
    handler: (actor, a) => billing.recordPayment(actor, a),
  },
  {
    name: "list_payments",
    description: "List payments. Optionally filter by invoiceId or organizationId.",
    inputSchema: {
      type: "object",
      properties: {
        ...pagination,
        invoiceId: str("Filter to this invoice id"),
        organizationId: str("Filter to this organization (client) id"),
      },
      additionalProperties: false,
    },
    handler: (actor, a) => billing.listPayments(actor, a),
  },

  /* ----------------------------- deadlines ------------------------------- */
  {
    name: "list_deadlines",
    description: "List compliance deadlines. Optionally filter by organizationId or status.",
    inputSchema: {
      type: "object",
      properties: {
        ...pagination,
        organizationId: str("Filter to this organization (client) id"),
        status: str("One of: upcoming, in_progress, filed, extended, missed, na"),
      },
      additionalProperties: false,
    },
    handler: (actor, a) => deadlines.listDeadlines(actor, a),
  },
  {
    name: "create_deadline",
    description: "Create a compliance deadline. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: str("Client (organization) id (required)"),
        name: str("Deadline name (required)"),
        dueDate: { ...dateField, description: "Due date (required) — " + dateField.description },
        form: str("Form (e.g. 1120, 1040)"),
        jurisdiction: str("Jurisdiction (default federal)"),
        taxPeriod: str("Tax period"),
      },
      required: ["organizationId", "name", "dueDate"],
      additionalProperties: false,
    },
    handler: (actor, a) => deadlines.createDeadline(actor, a),
  },
  {
    name: "get_deadline",
    description: "Get a single compliance deadline by id.",
    inputSchema: idSchema("deadline"),
    handler: (actor, a) => deadlines.getDeadline(actor, String(a.id)),
  },
  {
    name: "update_deadline",
    description: "Update a compliance deadline by id. Requires staff role or higher.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Deadline id (required)"),
        name: str("Deadline name"),
        dueDate: { ...dateField, description: "Due date — " + dateField.description },
        form: str("Form (e.g. 1120, 1040)"),
        jurisdiction: str("Jurisdiction"),
        taxPeriod: str("Tax period"),
        status: str("One of: upcoming, in_progress, filed, extended, missed, na"),
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: (actor, a) => {
      const { id, ...patch } = a;
      return deadlines.updateDeadline(actor, String(id), patch);
    },
  },

  /* ----------------------------- reference + search ---------------------- */
  {
    name: "list_reference",
    description:
      "Return reference data for resolving ids: work types, work statuses, users, and tags.",
    inputSchema: NONE,
    handler: async (actor) => {
      const [workTypes, workStatuses, users, tags] = await Promise.all([
        reference.listWorkTypes(actor),
        reference.listWorkStatuses(actor),
        reference.listUsers(actor),
        reference.listTags(actor),
      ]);
      return { workTypes, workStatuses, users, tags };
    },
  },
  {
    name: "search",
    description:
      "Cross-entity search by name/title across organizations, contacts, work items, and invoices.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("Search term (required)"),
        limit: num("Max results per entity type (1-50, default 10)"),
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: (actor, a) => {
      const { query, ...opts } = a;
      return searchSvc.search(actor, query, opts);
    },
  },
];

/* --------------------------------------------------------------------------
 * Wiring
 * ------------------------------------------------------------------------ */

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function main() {
  // Resolve the actor ONCE. May be null (missing/invalid/revoked key) — we
  // still start so tools/list works for discovery.
  let actor: ApiActor | null = null;
  try {
    actor = await resolveActorFromKey(process.env.KARBONCOPY_API_KEY);
  } catch (err) {
    // Never crash on startup — surface it via tool calls instead.
    console.error("[mcp] failed to resolve KARBONCOPY_API_KEY:", err);
  }
  if (actor) {
    console.error(`[mcp] authenticated as ${actor.name} <${actor.email}> (role: ${actor.role})`);
  } else {
    console.error(
      "[mcp] no valid API key — tools are discoverable but every call will error. Set KARBONCOPY_API_KEY.",
    );
  }

  const byName = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: "karboncopy", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: [
        "KarbonCopy MCP — query and enter data for a CPA firm's practice management app.",
        "Money is always integer cents. Dates accept ISO strings or epoch ms.",
        "Use list_reference to resolve work-type / work-status / user ids, and search to find entities by name.",
        "Reads need any valid key; creates/updates need a staff-or-higher key.",
      ].join(" "),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const def = byName.get(req.params.name);
    if (!def) return fail(`Unknown tool: ${req.params.name}`);

    if (!actor) {
      return fail(
        "Not authenticated. Set the KARBONCOPY_API_KEY environment variable to a valid key " +
          "(create one in KarbonCopy under Settings → API Keys), then restart the MCP server.",
      );
    }

    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await def.handler(actor, args);
      return ok(result);
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(`${err.code}: ${err.message}`);
      }
      console.error(`[mcp] tool ${def.name} failed:`, err);
      return fail(`internal: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] karboncopy MCP server ready on stdio");
}

main().catch((err) => {
  console.error("[mcp] fatal:", err);
  process.exit(1);
});
