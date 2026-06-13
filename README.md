# KarbonCopy

**Local-first, LAN-accessible practice management for CPA firms.**
Karbon-style work/clients/triage/time/docs + a real-time **file-server completion-alert**
system, AI assist, and a modern UI — all self-hosted on your office network.

---

## Quick start

> **Required:** this repo ships an `.npmrc` with `node-linker=hoisted`. Keep it. With pnpm's
> default symlinked layout, webpack bundles Next.js's React context twice and the production
> client crashes with *"invariant expected layout router to be mounted."* Hoisted (flat)
> node_modules fixes it. Always verify changes against the **prod build** (`pnpm build && pnpm start`)
> in a real browser — `next dev` can mask this class of bug.

```bash
pnpm install            # installs deps (native better-sqlite3 builds automatically)
cp .env.example .env.local   # then edit AUTH_SECRET etc.
pnpm db:generate        # generate SQL migration from schema
pnpm db:migrate         # create the SQLite database
pnpm db:seed            # demo firm: clients, work, users
pnpm dev                # http://localhost:3000  (also on your LAN IP)
```

Default login: **admin@firm.com / admin123**

### Production / office deployment

```bash
pnpm build
pnpm start              # binds 0.0.0.0:3000 — reachable by every device on the LAN
```

The console prints the LAN URL (e.g. `http://192.168.1.202:3000`). Share that with staff.
To run it as an always-on Windows service, wrap `pnpm start` with
[NSSM](https://nssm.cc/) or [PM2](https://pm2.keymetrics.io/).

> **Note:** configure the bind address with `HOST` (not `HOSTNAME` — shells export
> `HOSTNAME` and it would shadow your setting).

---

## Architecture

| Concern | Tech |
|---|---|
| App | Next.js 15 (App Router) + React 19 + TypeScript |
| Server | Custom `server.ts` — Next + Socket.IO + file watcher in one process |
| Data | SQLite + Drizzle ORM (`data/karboncopy.db`) |
| Realtime | Socket.IO (alerts, presence, notifications) |
| File watching | chokidar (`src/server/watcher.ts`) |
| Auth | scrypt + cookie sessions, RBAC (`src/lib/auth.ts`) |
| UI | Tailwind + shadcn/ui + 21st.dev components |
| AI (optional) | Claude (`@anthropic-ai/sdk`) — set `ANTHROPIC_API_KEY` |

```
server.ts                  unified Next + Socket.IO + watcher
src/db/schema.ts           the frozen data model (all entities)
src/server/watcher.ts      ⭐ file-server completion-alert engine
src/server/realtime.ts     Socket.IO emit helpers
src/lib/auth.ts            sessions, RBAC
src/lib/realtime-client.tsx  client socket hook + global toasts
src/app/(app)/*            authenticated app (dashboard + modules)
src/app/(auth)/login       login
src/components/ui/*         shadcn primitives
```

---

## ⭐ File-server completion alerts

1. **Settings → Watched Folders**: add a root (e.g. `\\FILESERVER\Clients`).
2. Add **rules** with a glob (`**/Completed/**`, `**/*_FINAL.*`), who to notify, and a message.
3. When a matching file lands, KarbonCopy auto-links it to the client (by folder name) and
   work item, records a `fileEvent`, notifies the right users, and pushes a live toast to
   every connected browser on the LAN. Acknowledge or open the work from the **File Alerts** page.

UNC shares are watched with polling automatically.

---

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | dev server (HMR) on the LAN |
| `pnpm build` / `pnpm start` | production |
| `pnpm db:generate` / `db:migrate` / `db:push` | schema → DB |
| `pnpm db:seed` | demo data |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm typecheck` | TypeScript |

See `PLAN.md` for the full feature roadmap and build status.
