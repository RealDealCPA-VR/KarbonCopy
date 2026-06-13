# KarbonCopy — Hybrid Architecture (LAN core + public surface)

The product is **local-first** (data + app live on the firm's LAN), but three features need
to reach people **outside** the LAN: the client **portal**, **payment** confirmation, and
inbound **email**. Decision: **one app, a small public surface, exposed via a tunnel** — not a
separate relay service (keeps self-hosting to a single process).

## Model

```
                         ┌─────────────────────────── firm LAN ───────────────────────────┐
   staff browsers ─────▶ │  KarbonCopy (Next + Socket.IO + watcher)  0.0.0.0:3000           │
                         │   • staff auth   : kc_session cookie (lib/auth)                   │
   file server ────────▶ │   • SQLite (data/karboncopy.db) + uploads (data/uploads)         │
                         │   • QuickBooks/Lacerte MCP (localhost stdio/HTTP)                 │
                         └──────────────▲──────────────────────────────────────────────────┘
                                        │ only /portal/**, /api/portal/**, /api/webhooks/**
   clients (internet) ──▶ Cloudflare Tunnel / reverse proxy ──┘   (public hostname)
```

- **Public surface = a route allowlist only.** `middleware.ts` already treats `/portal` and
  `/api/portal` as public. Add `/api/webhooks/**` (Stripe). Everything else stays staff-gated.
  The operator points a **Cloudflare Tunnel** (or nginx/Caddy reverse proxy) at `:3000` but
  only forwards those paths to the internet; the firm subnet keeps full access.
- **Two auth realms, two cookies:**
  - Staff: `kc_session` (existing).
  - Clients: `kc_portal` cookie → `portalSessions`/`portalUsers` (new). Portal code must NEVER
    call `getCurrentUser()`; it uses a separate `getPortalUser()` (to be added in `lib/portal-auth.ts`).
- **Payments:** Stripe **hosted checkout** + **webhook** (`/api/webhooks/stripe`). No card data
  touches KarbonCopy. The invoice `payToken` opens a public pay page under `/portal`.
- **Email:** firm enters SMTP/IMAP (or Gmail/Graph) creds in Settings → stored **encrypted**
  (`lib/crypto`) in `emailAccounts.configEnc`. A poller in the server process ingests into
  `inboxThreads`/`messages` (correlated via `messages.externalId`); sends via SMTP. No third
  party sees client mail; it flows firm-mailbox ↔ firm-server.
- **Integrations (QuickBooks Desktop, Lacerte):** the firm already runs MCP servers locally
  (`projects/Quickbooks MCP Desktop`, `projects/LacertMCP`). KarbonCopy stores their connection
  in `integrationConfigs.config` and calls them **over localhost** — never the cloud.

## Why not a separate relay service
A second process doubles ops (two services, two deploys, IPC) for a single-office tool. A tunnel
forwarding 3 path-prefixes gives the same isolation with one supervised process. If a firm later
wants the portal in a DMZ, the same Next app can run a second instance with only public routes
enabled — no code change.

## Security invariants for public routes
- Portal/webhook routes are rate-limited (reuse `api/documents/_ratelimit.ts`).
- Portal sessions are short-lived; portal users can only ever see their own org's data.
- Stripe webhooks verify the signature; the `payToken`/`magicToken` are high-entropy (nanoid 32).
- No staff-only data model is reachable from a `kc_portal` session.
