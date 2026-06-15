# KarbonCopy API (`/api/v1`)

Key-authenticated REST over the same service layer the MCP server uses. Everything an agent or
script needs to **enter and query data for the whole firm**. (For the conversational/Claude path,
see [`MCP.md`](./MCP.md).)

## Auth

Create a key in **Settings → API Keys** (admin only). The raw key (`kc_live_…`) is shown **once**.
A key **acts as** the user it was minted for and inherits that user's role (RBAC is enforced on
every call). Send it as either header:

```
Authorization: Bearer kc_live_xxxxxxxx
# or
X-API-Key: kc_live_xxxxxxxx
```

Responses: success → `{ "data": ... }` (200/201). Errors → `{ "error": { "code", "message", "details" } }`
with HTTP status (401 unauthorized, 403 forbidden, 404 not_found, 422 validation, 409 conflict, 500).
Money is integer **cents**. Dates accept ISO strings or epoch ms. List endpoints take
`?limit=&offset=&search=` plus per-resource filters.

## Endpoints

| Method · Path | Purpose |
|---|---|
| `GET /api/v1/me` | The acting user `{id,name,email,role}` |
| `GET·POST /api/v1/clients` · `GET·PATCH·DELETE /clients/:id` | Organizations (DELETE = archive) |
| `GET·POST /api/v1/contacts` · `GET·PATCH·DELETE /contacts/:id` | Contacts (`?organizationId=`) |
| `GET·POST /api/v1/work` · `GET·PATCH /work/:id` · `POST /work/:id/complete` | Work items (`?organizationId,assigneeId,statusId`) |
| `GET·POST /api/v1/work/:id/tasks` · `PATCH /work/:id/tasks/:taskId` | Checklist (`{completed}`) |
| `GET·POST /api/v1/time` · `PATCH·DELETE /time/:id` | Time entries |
| `GET·POST /api/v1/invoices` · `GET /invoices/:id` | Invoices (POST computes totals + number) |
| `GET·POST /api/v1/payments` | Payments (POST = record against an invoice) |
| `GET·POST /api/v1/deadlines` · `GET·PATCH /deadlines/:id` | Compliance deadlines (`PATCH {status}`) |
| `GET /api/v1/search?q=` | Cross-entity search (orgs, contacts, work, invoices) |
| `GET /api/v1/reference/{work-types,work-statuses,users,tags}` | Lookups for resolving ids |

## Examples

```bash
KEY=kc_live_xxxxxxxx
B=http://localhost:3000/api/v1

# Create a client
curl -s -X POST $B/clients -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Riverside Dental PC","entityType":"c_corp","email":"ap@riverside.com"}'

# Create work for them (resolve a statusId/workTypeId via /reference first)
curl -s -X POST $B/work -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Monthly Bookkeeping","organizationId":"<orgId>","priority":"normal"}'

# Draft an invoice
curl -s -X POST $B/invoices -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"<orgId>","lines":[{"description":"1040 prep","quantity":1,"unitCents":75000}]}'

# Search
curl -s "$B/search?q=Riverside" -H "Authorization: Bearer $KEY"
```

Roles: list/read = any key · create/update = `staff`+ · delete/archive = `manager`+.
All writes are logged to the activity timeline, attributed to the key's user.
