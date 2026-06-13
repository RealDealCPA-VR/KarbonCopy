# KarbonCopy — Local-First CPA Firm Practice Management

> A self-hosted, LAN-accessible practice-management platform for accounting firms.
> Karbon feature parity **+ more**, with a real-time **file-server completion-alert** system,
> AI assist (Claude), and a 21st.dev-grade UI.

---

## 0. Product Thesis

Accounting firms live inside Karbon, Jetpack, Canopy, and TaxDome — all cloud SaaS with
per-seat pricing and client data sitting on someone else's servers. **KarbonCopy** flips that:

- **Local-first / self-hosted** — runs on one machine in the office; data stays on the firm's LAN.
- **Zero per-seat cost** — every user on the local network logs in via the browser.
- **File-server aware** — watches the firm's network shares (`\\FILESERVER\Clients\...`) and
  fires real-time alerts the moment a deliverable lands in a "Completed" / "For Review" folder.
- **AI-native** — Claude-powered email drafting, work summarization, and task extraction.

Tagline: *"Your firm's brain, on your firm's network."*

---

## 1. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | One repo, SSR + API routes |
| Runtime server | **Custom Node server (`server.ts`)** | Hosts Next + Socket.IO + file watcher in one process |
| DB | **SQLite via Drizzle ORM (better-sqlite3)** | Local-first, zero-config, single file, fast |
| Realtime | **Socket.IO** | Live alerts, presence, notifications, board updates |
| File watching | **chokidar** | Watches UNC/network paths for completion events |
| Auth | **Auth.js (NextAuth v5) credentials + RBAC** | Local accounts, roles, sessions |
| UI | **Tailwind v4 + shadcn/ui + 21st.dev components** | Revolutionary UI/UX |
| Forms/validation | **react-hook-form + zod** | Type-safe end to end |
| State/data | **TanStack Query + server actions** | Cache + mutations |
| Charts | **Recharts** | Insights / capacity heatmaps |
| AI | **@anthropic-ai/sdk (claude-opus-4-8)** | Email drafts, summaries, task extraction |

**Deployment:** `pnpm build && pnpm start` on the office host; bind to `0.0.0.0` so every LAN
device reaches it at `http://<host-ip>:3000`. Optional Windows service via NSSM / PM2.

---

## 2. Feature Map (Karbon parity ✅ + KarbonCopy extras ⭐)

### A. Work Management ✅
- Work items (jobs) with type, status, assignees, due dates, client link
- Kanban board + list + calendar views, drag-to-restage
- Task checklists per work item, dependencies, sections
- Work templates + recurring work (monthly/quarterly/annual tax cadences)
- Automators (rules: when status → X, do Y; assign, notify, create task)
- ⭐ Capacity-aware scheduler & workload heatmap

### B. Triage / Shared Inbox ✅
- Firm-wide email triage, threads, assign-to-work, comments
- @mentions, internal notes on any entity
- ⭐ Claude AI draft & summarize replies

### C. Clients / CRM ✅
- Contacts (people) + Organizations (entities) + client groups
- Relationships, custom fields, tax IDs (EIN/SSN masked), entity types
- Client timeline (activity feed across work/docs/emails)

### D. Time & Budgets ✅
- Timers + manual time entries, billable flags
- Budgets per work item, budget-vs-actual, realization
- Timesheets + approval

### E. Documents & Client Portal ✅
- Document store, folders, versioning
- **Document/info requests** (client portal magic-link uploads)
- ⭐ Maps work items to file-server folders

### F. ⭐ File-Server Completion Alerts (the differentiator)
- Configure watched roots (`\\FILESERVER\Clients`) + rule folders ("Completed", "For Review", "Signed")
- chokidar detects add/change → matches to a client/work item → broadcasts alert
- In-app toast + notification + optional desktop/email; "Acknowledge" / "Open work"
- Audit log of every file event

### G. Insights & Analytics ✅
- Dashboards: work due, overdue, capacity, realization, WIP
- Per-staff and per-client reporting; export CSV

### H. Platform ⭐
- RBAC (Owner / Admin / Manager / Staff / Read-only)
- Global command palette (⌘K), real-time presence, notification center
- Activity/audit log everywhere; dark/light theme

---

## 3. Data Model (see `src/db/schema.ts`)

users, teams, roles · contacts, organizations, clientGroups · workTypes, workStatuses,
workItems, workTasks, workTemplates, templateTasks, automators · timeEntries, budgets ·
documents, folders, documentRequests · inboxThreads, messages, comments, mentions ·
notifications, activities · watchedRoots, fileRules, fileEvents · tags, customFields, sessions.

---

## 4. Build Phases & Agent Fan-Out

| Phase | Deliverable | Owner |
|---|---|---|
| **0. Foundation** | Scaffold, DB schema, auth, server+socket+watcher, UI shell, dashboard | main (this) |
| **1. Work mgmt** | Boards/list/calendar, tasks, templates, automators | agent |
| **2. Clients/CRM** | Contacts, orgs, timeline, custom fields | agent |
| **3. Triage inbox** | Threads, assign-to-work, AI drafts | agent |
| **4. Time & budgets** | Timers, timesheets, budget-vs-actual | agent |
| **5. Docs + portal** | Store, requests, client magic-links | agent |
| **6. File alerts** | Watcher config UI, rules, alert center | agent |
| **7. Insights** | Dashboards, reports, capacity heatmap | agent |
| **8. Polish** | 21st.dev components, ⌘K, theming, a11y | agent |
| **9. Deploy** | LAN binding, Windows service, seed, docs | main |

**Coordination rules (from past parallel-agent lessons):**
- Agents build against the **frozen DB schema** (this phase) — schema changes go through main.
- **No parallel `pnpm build`** — agents write code + typecheck their own module only; main runs the full build.
- Each agent returns a structured report (files touched, routes added, follow-ups).

---

## 5. Definition of Done (100%)
- [ ] `pnpm install && pnpm db:push && pnpm dev` runs clean
- [ ] Every feature module above functional end-to-end
- [ ] File-server watcher fires real alerts on the LAN
- [ ] Full `pnpm build` passes, no type errors
- [ ] Reachable from another LAN device at `http://<host-ip>:3000`
- [ ] Seed data + README deploy guide
- [ ] UI uses 21st.dev components, dark/light, ⌘K, responsive

---

## 6. Status Log
- **2026-06-13** — Phase 0 **COMPLETE & verified**: scaffold, frozen DB schema (33 tables),
  auth + RBAC + sessions, custom server (Next + Socket.IO + watcher) bound to LAN, dashboard
  with live aggregates, notification center + realtime toasts, ⌘K palette, theming, 20 UI
  primitives. **Build passes, typecheck clean.** File-server watcher verified end-to-end:
  dropped file → auto-linked to client + work item → rule-targeted notifications → live broadcast.
- **2026-06-13** — Phase 1/2/6 agent wave (Work, Clients/CRM, File Alerts + Admin) — built, typecheck + build green, all routes render with auth.
- **2026-06-13** — Phase 3/4/5/7 agent wave (Triage+AI, Time & Budgets, Documents + Client Portal, Insights) — built; fixed RSC `export const` violation; full build green (24 routes). Verified: document upload + portal upload write-paths (files on disk, request fulfillment, notifications).
- **2026-06-13** — **Prod client-crash investigation & fix.** Every Next App Router prod build crashed client-side ("invariant expected layout router to be mounted"); reproduced on a stock app in both Chrome 141 & Edge 149. Root cause: pnpm symlinks → duplicate Next React context. **Fixed via `.npmrc` `node-linker=hoisted`.** Real app now renders flawlessly — **visually verified** (Chrome 141 screenshots): dashboard (light+dark), Kanban work board, Insights charts, login, client portal w/ real fulfillment state. Zero console errors.
- **STATUS: functionally complete + visually verified + LAN-deployable.** Remaining polish: dedicated 21st.dev component pass, per-mutation interaction tests, Windows-service deploy, favicon.
