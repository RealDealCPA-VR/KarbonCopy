# KarbonCopy programmatic API + MCP — build contract

Goal: let Claude (and scripts) **enter and query data for everything** via (a) a key-authed
`/api/v1` REST surface and (b) an in-repo **MCP server** — both over ONE shared, pure service layer.

## Service layer (`src/lib/api/services/*.ts`) — the contract

Every service module is **pure** (no `server-only`, no `next/*`, no `revalidatePath`). Mirror the
exemplar `organizations.ts`. Each function takes an explicit `actor: Actor` (the API key's user),
enforces RBAC, validates with zod (`parse`), logs an activity, and returns a plain object.
Throw `ApiError` (from `@/lib/api/errors`) — never return error shapes.

Helpers come from `./_base`: `db, schema, Actor, requireWrite(actor), requireManager(actor),
parse(zodSchema, input), logActivity(...), pagination`. RBAC floors: list/get = any actor;
create/update = `requireWrite` (staff+); delete/archive = `requireManager`.

**Standard shape per entity:**
- `list<Plural>(actor, input)` → `T[]`  (input = `{limit?,offset?,search?}`)
- `get<Singular>(actor, id)` → `T`  (throws `notFound`)
- `create<Singular>(actor, input)` → `T`
- `update<Singular>(actor, id, input)` → `T`
- `archive<Singular>(actor, id)` / `delete...` → `{ id, archived|deleted: true }`

**Modules + functions to build** (exemplar `organizations.ts` already done):
- `contacts.ts` — list/get/create/update/deleteContact (+ filter by organizationId; fields: firstName,lastName,email,phone,title,organizationId,isPrimary,portalEnabled)
- `work.ts` — list/get/createWorkItem (title, workTypeId?, statusId?, organizationId?, contactId?, assigneeId?, priority?, startDate?, dueDate?, budgetMinutes?), updateWorkItem, completeWorkItem(actor,id); tasks: listTasks(actor,workItemId), addTask, toggleTask(actor,taskId,completed)
- `time.ts` — list/create/update/deleteTimeEntry (userId defaults to actor.id; workItemId?, minutes, date, billable?, description?, rateCents?)
- `billing.ts` — listInvoices, getInvoice, createInvoice(actor,{organizationId,contactId?,issueDate?,dueDate?,lines:[{description,quantity,unitCents}],taxBps?,discountCents?,notes?,terms?}) → computes totals (tax = taxBps applied to subtotal−discount) + sequential number, recordPayment(actor,{invoiceId,amountCents,method?,reference?}), listPayments
- `deadlines.ts` — list/get/createDeadline (organizationId,name,dueDate,form?,jurisdiction?,taxPeriod?), updateDeadline, setDeadlineStatus(actor,id,status)
- `reference.ts` — listWorkTypes/listWorkStatuses/listUsers/listTags (read-only, any actor; for resolving ids)
- `search.ts` — `search(actor, query, {limit?})` → `{ organizations[], contacts[], workItems[], invoices[] }` (name/title contains)

Keep money in integer cents; dates accept ISO strings or epoch ms (coerce in zod). Do NOT edit
`organizations.ts`, `_base.ts`, `errors.ts`, or `schema.ts`.

## REST (`src/app/api/v1/**`) — Agent R

- Auth: `const actor = await requireActor(req)` (from `@/lib/api/auth`) → 401 if no/invalid key.
  Key sent as `Authorization: Bearer <key>` or `X-API-Key`.
- Map ApiError→`{ error: { code, message, details } }` with `err.status`; success→`{ data }` (200/201).
- Resources (each → a service): `clients`(organizations), `contacts`, `work`, `work/[id]/tasks`,
  `time`, `invoices`, `payments`, `deadlines`, `search`, `reference/{work-types,work-statuses,users,tags}`.
  Pattern: `GET /api/v1/<res>` (list, query params), `POST /api/v1/<res>` (create),
  `GET|PATCH|DELETE /api/v1/<res>/[id]`. Add a central `respond()`/`handle()` helper in
  `src/app/api/v1/_util.ts` to DRY error mapping. Also `GET /api/v1/me` (returns the actor).

## MCP server (`src/mcp/server.ts`) — Agent M

- Use `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport`. Name "karboncopy".
- Auth: read `process.env.KARBONCOPY_API_KEY`, resolve via `resolveActorFromKey`; if absent/invalid,
  still start but every tool returns an auth error (so `tools/list` works for discovery).
- Register one tool per high-value service fn with a JSON-schema input — full CRUD across the
  entities (33 tools today): clients (`list/get/create/update/delete_client`), contacts
  (`list/get/create/update/delete_contact`), work (`list/get/create/update/complete_work`,
  `add_task/toggle_task/list_tasks`), time (`log_time/list_time/update_time/delete_time`), invoices
  (`list/get/create_invoice`, `record_payment`, `list_payments`), deadlines (`list/get/create/update_deadline`), plus
  `search` and `list_reference`. Each tool calls the service with the resolved actor and returns
  `content:[{type:"text", text: JSON.stringify(result)}]`; on ApiError return `isError:true`.
- Load env first (dotenv `.env.local`), like `server.ts`. Add `package.json` script
  `"mcp": "tsx --tsconfig tsconfig.server.json src/mcp/server.ts"` and document the Claude Desktop /
  Claude Code config snippet in `MCP.md` (command, args, env: KARBONCOPY_API_KEY, DATABASE_URL,
  APP_ENCRYPTION_KEY). DB access is its own better-sqlite3 connection (WAL → safe alongside the app).

## API keys UI — Agent K

- `Settings → API Keys` (admin only). List keys (name, prefix, lastUsedAt, revoke). "Create key"
  dialog (name; acts as the current user) → call `createApiKey` and show the raw key ONCE with a copy
  button + warning it won't be shown again. Use `@/lib/api/auth` (createApiKey/revokeApiKey/listApiKeys).
  Add under `src/app/(app)/settings/api-keys/**` (new subroute — do NOT touch settings/page.tsx).
