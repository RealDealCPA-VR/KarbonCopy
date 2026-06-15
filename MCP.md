# KarbonCopy MCP server

An in-repo [Model Context Protocol](https://modelcontextprotocol.io) server that
lets Claude Desktop and Claude Code **enter and query everything in KarbonCopy**
— clients, contacts, work items, tasks, time, invoices, payments, deadlines —
through MCP tools.

It runs as a standalone stdio process (`src/mcp/server.ts`) over the same
**pure service layer** (`src/lib/api/services/*`) that the REST API uses, and
talks to the **same local SQLite database** as the running app via its own
`better-sqlite3` connection. SQLite is opened in **WAL mode**, so the MCP
server is safe to run alongside the live app on `:3000` — concurrent reads and
serialized writes work without corrupting the database.

Every tool acts **as the user who owns the API key** (inheriting that user's
role and RBAC). Reads need any valid key; creates/updates need a key whose user
is **staff or higher**.

---

## 1. Create an API key

In the KarbonCopy app:

1. Go to **Settings → API Keys** (admin only).
2. Click **Create key**, give it a name (e.g. "Claude Desktop").
3. Copy the raw key — it is shown **only once** and looks like
   `kc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. Store it safely.

The key acts as the currently-signed-in user, so its capabilities match that
user's role.

---

## 2. Run it

```bash
pnpm mcp
```

This launches `tsx --tsconfig tsconfig.server.json src/mcp/server.ts`. The
process loads `.env.local` (then `.env`) itself, resolves
`KARBONCOPY_API_KEY` to an actor once at startup, and serves MCP over stdio.

> If the key is missing or invalid the server **still starts** (so `tools/list`
> works for discovery), but every tool call returns a clear
> "Set KARBONCOPY_API_KEY" error.

Required environment variables (read from `.env.local`/`.env` or the MCP host's
`env` block):

| Variable              | Purpose                                                        |
| --------------------- | ------------------------------------------------------------- |
| `KARBONCOPY_API_KEY`  | The `kc_live_…` key the tools authenticate as.                |
| `DATABASE_URL`        | Path to the SQLite DB, e.g. `file:./data/karboncopy.db`.      |
| `APP_ENCRYPTION_KEY`  | Same key the app uses; needed to decrypt PII (e.g. client EINs). |

---

## 3. Claude Desktop config

Add a `karboncopy` entry under `mcpServers` in your
`claude_desktop_config.json` (replace `<repo>` with the absolute path to this
repository, e.g. `C:\\Users\\VR\\projects\\KarbonCopy`):

```json
{
  "mcpServers": {
    "karboncopy": {
      "command": "pnpm",
      "args": ["mcp"],
      "cwd": "<repo>",
      "env": {
        "KARBONCOPY_API_KEY": "kc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "DATABASE_URL": "file:./data/karboncopy.db",
        "APP_ENCRYPTION_KEY": "<same APP_ENCRYPTION_KEY as the app>"
      }
    }
  }
}
```

`cwd` matters: `DATABASE_URL` uses a relative `file:./data/...` path, and the
`pnpm mcp` script must resolve from the repo root.

---

## 4. Claude Code config

```bash
claude mcp add karboncopy \
  --env KARBONCOPY_API_KEY=kc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --env DATABASE_URL=file:./data/karboncopy.db \
  --env APP_ENCRYPTION_KEY=<same APP_ENCRYPTION_KEY as the app> \
  -- pnpm mcp
```

Run it from the repository root so the working directory (and the relative
`DATABASE_URL`) resolve correctly.

---

## 5. Tools

| Tool             | What it does                                                              |
| ---------------- | ------------------------------------------------------------------------ |
| `list_clients`   | List clients (organizations); `limit` / `offset` / `search`.             |
| `get_client`     | Get one client by `id`.                                                   |
| `create_client`  | Create a client. Requires staff+.                                         |
| `update_client`  | Update a client by `id`. Requires staff+.                                 |
| `list_contacts`  | List contacts; optional `organizationId` filter.                         |
| `create_contact` | Create a contact. Requires staff+.                                        |
| `list_work`      | List work items; optional `organizationId` / `assigneeId` / `statusId`.  |
| `get_work`       | Get one work item by `id`.                                                |
| `create_work`    | Create a work item. Requires staff+.                                      |
| `complete_work`  | Mark a work item complete. Requires staff+.                              |
| `add_task`       | Add a checklist task to a work item. Requires staff+.                    |
| `toggle_task`    | Complete / reopen a checklist task. Requires staff+.                     |
| `log_time`       | Log a time entry (defaults `userId` to the key's user). Requires staff+. |
| `list_time`      | List time entries; optional `userId` / `workItemId`.                     |
| `list_invoices`  | List invoices; optional `organizationId` / `status`.                     |
| `get_invoice`    | Get one invoice (with lines) by `id`.                                     |
| `create_invoice` | Create an invoice (totals + number computed server-side). Requires staff+. |
| `record_payment` | Record a payment on an invoice (recomputes status). Requires staff+.     |
| `list_deadlines` | List compliance deadlines; optional `organizationId` / `status`.        |
| `create_deadline`| Create a compliance deadline. Requires staff+.                          |
| `list_reference` | Return work types + work statuses + users (for resolving ids).          |
| `search`         | Cross-entity search across orgs, contacts, work items, invoices.        |

**Conventions:** money is always **integer cents**; dates accept **ISO strings
or epoch ms**. Use `list_reference` to resolve work-type / work-status / user
ids, and `search` to find entities by name. On error, a tool returns
`isError: true` with a message like `forbidden: Requires staff role or higher`.

---

## 6. Notes

- **Own connection, WAL-safe.** The MCP process opens its own `better-sqlite3`
  connection (`src/db`) in WAL mode — safe to run while the app server holds the
  database open on `:3000`.
- **Pure service layer, no Next.** The server imports only the service layer +
  `lib/api/auth` + the db. It does **not** import any Next-only / `server-only`
  code, and it loads its own env. DB writes go through the same validated,
  RBAC-enforced, activity-logged services as the REST API. (Realtime
  socket/UI updates are not emitted from this process; the next app read picks
  up the changes.)
