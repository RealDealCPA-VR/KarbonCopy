<div align="center">

# 🛡️ KarbonCopy

### The entire practice, on your firm's network. Not someone else's cloud.

**The all-in-one, local-first command center for accounting firms** — work, clients, billing,
a real client portal, e-signatures, a compliance auto-pilot, and an on-prem AI that actually
*reads your files and watches your books* — all running on a box in your office, reachable by
every device on your LAN.

*Your firm's brain. Your firm's hardware. Your client's data never leaves the building.*

</div>

---

## Why KarbonCopy exists

Karbon, Canopy, and TaxDome are great — and they all park your clients' SSNs, EINs, and tax
returns on **someone else's servers**, billed **per seat, forever**. KarbonCopy flips the model:

> 🔒 **Local-first is the moat.** Because KarbonCopy runs *on your network*, it can do things a
> cloud SaaS structurally **cannot** — silently OCR SSN-bearing documents on your own hardware,
> read your live QuickBooks Desktop file, watch your file server in real time, and sign 8879s
> without shipping a single byte to a third-party vendor.

| | The Cloud Incumbents | **KarbonCopy** |
|---|---|---|
| Where your client data lives | their datacenter | **your office** 🏠 |
| Pricing | $$$ / seat / month, forever | **self-hosted, your hardware** |
| Works with no internet | ❌ | ✅ **fully offline-capable** |
| Reads your *live* QuickBooks Desktop & Lacerte | ❌ | ✅ **on localhost** |
| OCRs tax docs on-prem | ❌ | ✅ **never leaves the LAN** |
| Knows the second a return hits the file server | ❌ | ✅ **real-time alerts** |

Spin it up on one machine. Every laptop, tablet, and phone in the office opens
`http://<your-ip>:3000` and they're in. That's it.

---

## ⭐ The killer feature: your file server, finally awake

Your team already saves returns to `\\FILESERVER\Clients\...`. KarbonCopy **watches it live**.

The moment a file lands in a `Completed/` or `_FINAL` folder, KarbonCopy:

1. **detects it instantly** (chokidar, UNC-aware),
2. **auto-links it** to the right client *and* the open job,
3. **reads it** — on-prem OCR classifies it (W-2, 1099, K-1, 8879, bank stmt…) and extracts fields,
4. **auto-fulfills** the matching client document request,
5. **pings the right people** with a real-time toast on every screen in the office.

A passive network share just became an **autonomous intake brain**. No competitor does this,
because no competitor runs *inside your building*.

---

## 🚀 Everything in the box

**Run the firm**
- 📋 **Work** — Kanban / list / calendar, drag-to-restage, checklists, templates, automators
- 🗓️ **Compliance calendar** — federal + state deadlines **auto-generated** from each client's
  entity type & fiscal year; the scheduler spawns the recurring work for you
- 👥 **Clients / CRM** — orgs, contacts, timelines, custom fields, **encrypted EIN/SSN**
- 📨 **Triage inbox** — shared firm inbox with **real two-way email** (SMTP + IMAP) and Claude-drafted replies
- ⏱️ **Time & budgets** — live timers, timesheets, budget-vs-actual, approvals

**Get paid & delight clients**
- 🧾 **Billing** — invoices, **invoice-from-WIP**, Stripe checkout, payments, receipts
- 🌐 **Client portal** — secure client login: upload docs, view & **pay invoices**, get requests
- ✍️ **E-signature** — sign 8879s & engagement letters **on-prem**, tamper-evident audit trail, zero DocuSign

**The unfair advantages**
- 🧠 **On-prem document AI** — OCR + classify + extract + auto-match, cloud-optional
- 🔌 **QuickBooks Desktop + Lacerte** — wired to your local MCP servers, no double entry
- 🚨 **Books-Health Radar** — always-on QC that flags duplicate payments, backdated entries,
  round-dollar plugs, uncategorized spikes & reconciliation drift the quarterly sync never sees
- ✨ **AI workflow builder** — describe an engagement in plain English, get a ready-to-apply
  template + tasks + automations grounded in *your* firm's setup
- 📊 **Insights** — throughput, realization, WIP, and a staff **capacity heatmap**

All wrapped in a fast, modern, dark-mode UI (Next.js 15 + Tailwind + shadcn/21st.dev), with a
⌘K command palette, live presence, and real-time notifications across the whole office.

---

## ⚡ Quick start

```bash
pnpm install                 # native better-sqlite3 builds automatically
cp .env.example .env.local   # set AUTH_SECRET + APP_ENCRYPTION_KEY (the rest are optional)
pnpm db:generate && pnpm db:migrate   # create the local SQLite database
pnpm db:seed                 # demo firm: clients, work, deadlines, invoices, alerts
pnpm dev                     # → http://localhost:3000  (and on your LAN IP)
```

**Log in:** `admin@firm.com` / `admin123`

### Ship it to the office

```bash
pnpm build
pnpm start    # binds 0.0.0.0:3000 — every device on the LAN can reach it
```

The console prints your network URL (e.g. `http://192.168.1.202:3000`) — share it with the team.
For always-on, run it as a service with **PM2** or **NSSM** (see [`OPS.md`](./OPS.md)) and schedule
`pnpm backup` for automated, encrypted-at-rest SQLite snapshots.

### Light it all up (optional)

Drop these in `.env.local` to unlock the power features — KarbonCopy degrades gracefully without them:

| Add | Unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | Claude email drafts, doc classification, AI workflow builder |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Card/ACH invoice payments via the client portal |
| Email account in **Settings → Email** | Real two-way client email in Triage |
| MCP config in **Settings → Integrations** | Live QuickBooks Desktop & Lacerte |
| Watched folder in **Settings → Watched Folders** | The file-server alert + OCR intake engine |

---

## 🧱 Architecture

One process. One SQLite file. Zero cloud dependencies.

| Concern | Tech |
|---|---|
| App | Next.js 15 (App Router) · React 19 · TypeScript |
| Server | Custom `server.ts` — Next + Socket.IO + file watcher + scheduler + email poller, in one process |
| Data | SQLite + Drizzle ORM (`data/karboncopy.db`) — local-first, zero-config |
| Realtime | Socket.IO (cookie-authenticated) — alerts, presence, notifications |
| Auth | scrypt + cookie sessions, 5-tier RBAC; encrypted PII at rest |
| Integrations | QuickBooks Desktop / Lacerte over **localhost** MCP |
| UI | Tailwind + shadcn/ui + 21st.dev components |

The public surface (client portal, payments, inbound email) is a small **route allowlist** you
expose via a reverse proxy / Cloudflare Tunnel — the rest stays firewalled on the LAN. See
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 🔐 Built to hold real client data

5-tier RBAC enforced on every mutation · EIN/SSN encrypted at rest (AES-256-GCM) · cookie-auth'd
realtime sockets · upload size/type limits + rate limiting · IDOR-scoped document access ·
tamper-evident e-sign audit chains · automated backups · transactional writes. Security review
findings and the full roadmap live in [`REVOLUTIONARY_ROADMAP.md`](./REVOLUTIONARY_ROADMAP.md).

---

## 🛠️ Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` / `pnpm dev:watch` | local dev (LAN-accessible) |
| `pnpm build` / `pnpm start` | production |
| `pnpm db:generate` · `db:migrate` · `db:seed` · `db:studio` | database |
| `pnpm backup` | online SQLite snapshot (+ prune) |
| `pnpm typecheck` | TypeScript |

---

## 📎 Running it for real — two things to know

- **Keep the `.npmrc` (`node-linker=hoisted`).** pnpm's default symlinks make webpack double-bundle
  Next's React context and the prod client crashes (*"invariant expected layout router to be
  mounted"*). Flat node_modules fixes it. Verify changes against the **prod build**, not just `next dev`.
- **Bind with `HOST`, not `HOSTNAME`** (shells export `HOSTNAME` and would shadow it). The custom
  server runs via `tsconfig.server.json`; before a fresh `pnpm build`, stop any stray dev process.

---

<div align="center">

**KarbonCopy** — stop renting your firm's brain. Own it. 🛡️

*Built with [Claude Code](https://claude.com/claude-code).*

</div>
