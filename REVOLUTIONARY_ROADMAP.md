# KarbonCopy — Audit Findings & Revolutionary Roadmap

> Synthesized from a 20-auditor deep review (modules, security, data, perf, resilience, ops,
> realtime, competitive parity, and category-defining strategy). 2026-06-13.

## Verdict

**Not a true one-stop local-first shop yet.** KarbonCopy is a well-built, polished *internal*
practice-management tool (work/kanban, CRM, time, internal triage, document store, and a
genuinely differentiated file-server completion-alert engine) on a sound auth + SQLite +
Socket.IO + watcher runtime. Happy paths work; UI quality is high. It falls short on three axes:

1. **Production-readiness** — it was running in Next.js **dev mode**, zero DB transactions, zero
   error boundaries, no backups, no always-on service, no process crash handler (the source of
   the observed `-1` exits), and a socket layer that trusts a **client-supplied userId**.
2. **Security/RBAC** — the advertised 5-tier RBAC is cosmetic (**0 `hasRole` checks** across
   work/clients/inbox/documents/alerts mutations); document download is an **IDOR**; **EIN/SSN
   stored in plaintext** and shipped to the browser; both upload endpoints accept **any file at
   any size** (unauthenticated portal DoS).
3. **Competitive scope** — the entire client-facing/revenue half is absent: no billing/invoicing/
   payments, no real two-way email (the inbox never sends/receives), no proposals/e-sign, no
   authenticated client portal, no tax-deadline calendar, no QuickBooks/tax-software integration.

The local-first **moat is asserted but unexploited**: the watcher is passive, recurrence/deadline
automation is dead (1 of 6 automator triggers implemented), and there's no in-process scheduler.

---

## Phase 0 — STABILIZE (security + correctness; do before anything else)

> The app is not safe to leave running in a firm today. Close these first.

| # | Item | Where |
|---|---|---|
| 0.1 | Authenticate the Socket.IO handshake from the `kc_session` cookie; derive userId server-side; reject unauthenticated sockets; restrict CORS to LAN host | `server.ts`, `realtime-client.tsx` |
| 0.2 | `requireRole(min)`/`requireWrite()` helper; gate **every** mutating action (block readonly; deletes/archives = manager+) | `work/clients/inbox/documents/alerts/*/actions.ts` |
| 0.3 | Org-scope the document download route + list pages (fix IDOR); log access | `api/documents/[id]` |
| 0.4 | Upload hard size cap (Content-Length → 413, streamed write), extension+magic-byte allowlist (415), per-token/IP rate limit | `api/documents/_storage.ts`, both upload routes |
| 0.5 | Encrypt EIN/SSN at rest (AES-GCM); never ship plaintext; gate cleartext behind manager+ | `clients/actions.ts`, schema |
| 0.6 | Compiled production build (esbuild/tsc → node), `NODE_ENV=production`, refuse to serve when `dev===true` | `package.json`, `server.ts` |
| 0.7 | `process.on('uncaughtException'/'unhandledRejection')` (log + keep running); `/healthz` | `server.ts` |
| 0.8 | Wrap all multi-row writes in `db.transaction` (template apply, convert-to-work, portal upload, message+thread-bump, contact primary-demote, watcher fan-out) | many |
| 0.9 | `global-error.tsx`, `(app)/error.tsx` + reset, `not-found.tsx`; safe fallbacks on heavy queries | `src/app/**` |
| 0.10 | Move watchers Map to `globalThis`; serialize `reloadWatchers` | `server/watcher.ts` |
| 0.11 | Kill the broadcast→`router.refresh()` storm: incremental patch or debounced/room-scoped, exclude actor | `work/board.tsx`, actions |
| 0.12 | Board done-column (load completed), dashboard counts (filter `deletedAt`), myWork ordering; standardize realtime notification payloads to full DB row | `work/data.ts`, `page.tsx`, emitters |
| 0.13 | Automators: implement remaining triggers/actions + recurrence + in-process scheduler — OR disable unimplemented UI options ("coming soon") | `work/automators.ts`, `settings` |
| 0.14 | Login hardening: remove plaintext default creds from page, force first-login change, min length, login rate-limit, invalidate sessions on role/active/password change, `eq(users.active,true)` in `getCurrentUser`, prune expired sessions | auth |
| 0.15 | Ops: PM2/NSSM service, automated SQLite backup + WAL checkpoint, log rotation, externalized `DATA_DIR`, request-host-derived portal URL, documented migrate-with-backup runbook | ops |

---

## Phase 1 — PARITY (credible Karbon/Canopy/TaxDome competitor)

First decide the **hybrid architecture**: LAN core + a thin internet-exposed relay/reverse proxy
for portal/payments/email/webhooks (clients are off-LAN — this is a prerequisite).

- **Billing** — invoices/lines/payments tables, invoice-from-WIP off time+budgets, Stripe/ACH via relay *(must, XL)*
- **Real email** — SMTP send + IMAP/Gmail/Graph ingestion into the inbox *(must, XL)*
- **Authenticated client portal (+PWA)** — client login (`contacts.portalEnabled`), doc inbox/outbox, secure messaging, invoice/pay *(must, XL)*
- **Proposals / engagement letters / e-signature** incl. 8879 *(must, XL)*
- **Tax-deadline/compliance calendar** seeded by entityType+FYE, auto-spawning recurring work *(must, L)*
- **QuickBooks + tax-software integration** (QBO API now, Desktop bridge later) *(must, L)*
- Recurring billing/retainers; custom-fields admin UI; client groups + contact detail page; work-template builder; mobile/hamburger nav; list virtualization + pagination *(should)*

---

## Phase 2 — REVOLUTIONARY (exploit the local-first moat) — ranked

1. **On-prem Document Understanding** — local OCR + classify + extract on watched files; auto-match to document requests/work, auto-fulfill. Turns the passive watcher into autonomous intake. Cloud SaaS *structurally cannot* OCR SSN-bearing docs on the firm's hardware. *(XL)*
2. **Compliance & deadline auto-engine** — bundled offline IRS/50-state calendar + in-process scheduler; from each client's entityType+FYE auto-generate correct recurring work, fire `due_approaching`/`all_tasks_done`, auto-chase late PBC. Revives the dead automators. *(L)*
3. **Local QuickBooks + tax-software bridge** — read QB Desktop (qbXML / watch `.QBW`) + index Lacerte/Drake/UltraTax client folders; deterministic folder→org binding. Knows the actual books and returns, not just metadata. *(XL)*
4. **AI-native workflow generation** — plain English → reviewable template+tasks+automators+fileRules diff, grounded in this firm's local config. *(L)*
5. **On-prem "books health" anomaly radar** — continuous local QC over QB + statements (dupes, round-dollar, backdating, reconciliation drift). Always-on, on-prem QC no cloud sync sees. *(L)*
6. **Offline-first LAN e-signature** — extend the portal to review+sign+stamp 8879/engagement letters with on-disk tamper-evident audit; no SSN ever leaves the building. *(L)*
7. Polish the moat: PWA portal with offline upload queue; desktop tray / native OS notifications for file-completion alerts.

---

## Status
- **2026-06-13** — Audit complete (22 agents).
- **2026-06-13** — **Phase 0 critical-security pass DONE & verified** (typecheck clean, prod build, server live, `healthz` reports `dev:false`):
  - ✅ 0.1 Socket.IO now authenticates from the `kc_session` cookie — verified: anon socket `rejected: UNAUTHENTICATED`, valid session `CONNECTED`. (`server.ts`, `lib/session.ts`, `realtime-client.tsx`)
  - ✅ 0.2 RBAC `requireWrite()/requireManager()/requireAdmin()` gates on **every** mutating action across work, clients, inbox, time, documents, alerts, settings. (`lib/auth.ts` + 5 module agents)
  - ✅ 0.3 Document-download IDOR fixed (org/role-scoped) + list scoping. ✅ 0.4 Upload size cap (413) + extension allowlist (415) + per-IP/token rate-limit (429). ✅ 0.5 EIN encrypted at rest (AES-256-GCM), masked by default, cleartext gated to manager+. (`lib/crypto.ts`)
  - ✅ 0.6 Runs as `NODE_ENV=production` (no longer dev mode); `dev` script de-watched. ✅ 0.7 `process.on(uncaughtException/unhandledRejection)` + `/healthz`. ✅ 0.8 DB transactions on multi-row writes (portal upload, convert-to-work, template apply, contact primary-demote, message+thread-bump). ✅ 0.9 `global-error.tsx` / `(app)/error.tsx` / `not-found.tsx`.
  - ✅ 0.10 Watcher Map on `globalThis` + serialized reload. ✅ 0.11 Broadcast→refresh storm debounced (1.5s, visible-tab). ✅ 0.12 Board done-column shows completed; dashboard counts exclude soft-deleted; realtime notification payloads standardized to full DB row. ✅ 0.13 Automator UI disables unimplemented triggers/actions. ✅ 0.14 (partial) default creds removed from login, session invalidation on role/active/password change, `getCurrentUser` rejects inactive, expired-session pruning.
  - ⏳ **Remaining Phase 0:** ops hardening (PM2/NSSM service, automated SQLite backups, log rotation, externalized DATA_DIR), login rate-limiting + forced first-login password change, compiled `dist` bundle.
- **NEXT:** finish Phase 0 ops, then Phase 1 parity (decide hybrid LAN+relay arch → billing, real email, authenticated portal, e-sign, deadline calendar, QuickBooks).
- **2026-06-13 — Phases 0(ops)/1/2 implemented in one 10-agent wave** (+ frozen schema of 14 new tables, `ARCHITECTURE.md` hybrid decision). Typecheck clean, prod build green (50+ routes), server live (`dev:false`), scheduler + email poller + watcher all boot. **Visually verified in Chrome 141:**
  - **Phase 0 ops:** login rate-limiting; `scripts/backup.mjs` (online SQLite backup + prune); `ecosystem.config.cjs` (PM2) + `OPS.md` (NSSM, log rotation, restore runbook); `/healthz`; crash handlers.
  - **Phase 1 parity:** Billing (invoices/lines/payments, invoice-from-WIP, Stripe checkout + `/api/webhooks/stripe`, public `/portal/pay/[token]`); real email (SMTP send + IMAP poller, encrypted creds, `/settings/email`); authenticated client portal (`kc_portal` realm, login/invite/dashboard/documents/invoices, org-scoped); e-signature (`/signatures` + public `/portal/sign/[token]`, pdf-lib stamping, tamper-evident hash-chain audit); **compliance/tax-deadline calendar (98 deadlines auto-generated by the scheduler)**; QuickBooks Desktop + Lacerte integration via the firm's local MCP servers (`/integrations`, test+sync).
  - **Phase 2 revolutionary:** on-prem document OCR/understanding wired into the watcher (`/intake` review queue, tesseract + optional Claude, auto-match to requests); **compliance auto-engine + in-process scheduler that revived the dead automators** (work_created/task_completed/all_tasks_done/due_approaching + recurrence expansion); local QB/Lacerte bridge; AI-native workflow generation (`/automate`, NL→template+tasks+automators+rules diff); **books-health anomaly radar (`/anomalies`, real duplicate-payment/backdating/round-dollar/uncategorized findings)**; offline LAN e-sign.
- **Honest caveats:** Stripe/email/AI/QB/Lacerte are built + UI-complete but need creds / the running MCP servers to function (graceful when absent). PDF-image OCR limited on this host (no rasterizer); image OCR works. Deferred Phase-1 "should" items: proposals/engagement-letters, recurring billing, custom-fields admin UI, client groups, mobile hamburger nav, list virtualization, inbox→send UI wiring. `server-only` is stubbed for the tsx custom server via `tsconfig.server.json`.
- **2026-06-15 — Programmatic / agent data-entry layer shipped & e2e-tested (18/18 green).** Pure
  service layer (`src/lib/api/services/*`, RBAC + zod + activity log, no Next deps) consumed by BOTH
  a key-authed **`/api/v1` REST API** (22 routes, `API.md`) and an in-repo **MCP server**
  (`pnpm mcp`, 33 tools, `MCP.md`) so Claude/scripts can create+query clients, work, tasks, time,
  invoices, payments, deadlines, search, reference. New `apiKeys` table + `Settings → API Keys` UI
  (mint once / revoke, acts-as-user). **End-to-end verified:** REST (auth 401, CRUD, invoice totals,
  search, 422 validation, key revocation) + MCP over stdio (tools/list, create_client, search) +
  DB persistence — all passing in a real prod build. Keys inherit the user's role; writes audited.
