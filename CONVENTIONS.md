# KarbonCopy — Build Conventions (read before building a module)

You are building one feature module of a Next.js 15 (App Router) app. The foundation
(DB, auth, realtime, UI primitives, app shell) is DONE and verified. Build ON it; do not
rebuild it.

## Hard rules
1. **Do NOT modify** `src/db/schema.ts`. It is the frozen shared contract. If you truly need
   a column, note it in your final report instead of editing.
2. **Do NOT run** `pnpm install`, `pnpm build`, `pnpm dev`, or start the server. The
   coordinator integrates and builds. You MAY run `pnpm exec tsc --noEmit` to check types,
   but do not modify config.
3. **Only create/edit files inside your assigned paths.** Do not touch other modules' folders,
   `server.ts`, `src/middleware.ts`, `src/lib/auth.ts`, `src/db/*`, or `src/components/ui/*`
   (those primitives already exist — import them).
4. Replace the placeholder page at your route (it currently renders `<PageStub/>`).

## Stack facts
- DB: `import { db, schema } from "@/db"` — Drizzle (better-sqlite3). Query with `drizzle-orm`
  helpers (`eq, and, or, desc, asc, isNull, inArray, gte, lte, count, sql`).
- IDs: text nanoid, auto-generated on insert (omit `id`). Timestamps: JS `Date` (mode timestamp_ms).
  Money: integer cents. `.returning()` is supported.
- Auth (server): `import { getCurrentUser, requireUser, hasRole } from "@/lib/auth"`.
- Realtime (server, to push live updates): `import { broadcast, emitToUser } from "@/server/realtime"`.
- Realtime (client): `import { useRealtime, useRealtimeEvent } from "@/lib/realtime-client"`.
- AI (optional, server): `import { aiEnabled, draftEmailReply, summarizeThread, extractTasks } from "@/lib/ai"`.
- Toasts (client): `import { toast } from "sonner"`.
- Utils: `cn`, `formatMinutes`, `formatMoneyCents`, `initials`, `colorForId` from `@/lib/utils`.

## UI primitives available (in `src/components/ui/`, import via `@/components/ui/<name>`)
button, card, input, label, textarea, badge, avatar, separator, dialog, command, popover,
select, checkbox, switch, tabs, table, dropdown-menu, tooltip, skeleton, progress.
Lucide icons via `lucide-react`. Charts via `recharts`. Dates via `date-fns`.

## Patterns
- **Pages**: server components in `src/app/(app)/<module>/...`. Use `export const dynamic = "force-dynamic"`
  for data pages. Fetch with `db` directly in the server component; call `requireUser()` for the actor.
- **Mutations**: prefer server actions in a co-located `actions.ts` (`"use server"`). After a write,
  log an `activities` row and (when relevant) create a `notifications` row + `emitToUser(...)`.
- **Client interactivity**: small `"use client"` components; use TanStack Query or actions.
- **API routes** (only if a client needs fetch): `src/app/api/<module>/route.ts`, guard with
  `getCurrentUser()` → 401.
- **Empty states & loading**: every list has a friendly empty state and (where useful) skeletons.
- **Quality bar**: this is a flagship product. Polished spacing, hover/active states, keyboard
  focus, responsive, dark-mode correct (use the CSS-var tokens, never hard-coded colors).
- 21st.dev components (https://21st.dev/community/components) are shadcn-compatible — match that
  visual quality: generous whitespace, soft shadows, rounded-xl cards, subtle motion.

## Final report (return as your last message)
- Files created/edited (paths)
- Routes/actions/APIs added
- Anything you stubbed or need from the coordinator (e.g. schema additions)
- Whether `tsc --noEmit` passed for your files
