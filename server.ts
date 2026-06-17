/**
 * KarbonCopy unified server.
 * Hosts Next.js + Socket.IO (realtime alerts/presence) + the file-server watcher
 * in a single process, bound to 0.0.0.0 so every device on the LAN can connect.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { createServer } from "node:http";
import { parse } from "node:url";
import os from "node:os";
import next from "next";
import { Server as IOServer } from "socket.io";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { setIO } from "@/server/realtime";
import { startWatchers, stopWatchers } from "@/server/watcher";
import { startScheduler, stopScheduler } from "@/server/scheduler";
import { startEmailPoller, stopEmailPoller } from "@/server/email";
import { validateSessionToken, readCookie, pruneExpiredSessions, pruneExpiredPortalSessions } from "@/lib/session";
import { encryptField, decryptField, canDecrypt } from "@/lib/crypto";

// Keep the long-lived LAN server alive through unexpected errors instead of
// crashing the whole firm's app (the observed exit -1). Log loudly.
process.on("uncaughtException", (err) => console.error("[server] uncaughtException:", err));
process.on("unhandledRejection", (err) => console.error("[server] unhandledRejection:", err));

const dev = process.env.NODE_ENV !== "production";
// NOTE: avoid HOSTNAME — shells (Git Bash) export it as the machine name,
// which dotenv won't override, causing a bad bind. Use HOST instead.
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[server] invalid PORT "${process.env.PORT}" — must be an integer 0-65535`);
  process.exit(1);
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function localIPs(): string[] {
  // best-effort: list non-internal IPv4 for the "share this link" hint
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}

app.prepare().then(async () => {
  // Ensure the database schema is up to date BEFORE any service (sockets,
  // scheduler, email poller, watcher) issues a query. A fresh install would
  // otherwise hit "no such table" until the operator remembered db:migrate.
  try {
    migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[db] migrations applied");
  } catch (err) {
    console.error("[db] migration failed — refusing to start a broken app:", err);
    process.exit(1);
  }

  // Ensure the ESSENTIAL work-status reference rows exist. The board groups work
  // items by status; without these a created item gets a null statusId and is
  // invisible. `pnpm db:seed` also creates these (plus demo data + the admin
  // user) — this is a defensive no-op when they're already present.
  try {
    const [hasStatus] = await db.select({ id: schema.workStatuses.id }).from(schema.workStatuses).limit(1);
    if (!hasStatus) {
      await db.insert(schema.workStatuses).values([
        { name: "To Start", category: "todo", position: 0, color: "#94a3b8", isDefault: true },
        { name: "In Progress", category: "in_progress", position: 1, color: "#3b82f6" },
        { name: "Waiting on Client", category: "waiting", position: 2, color: "#f59e0b" },
        { name: "Review", category: "review", position: 3, color: "#8b5cf6" },
        { name: "Complete", category: "done", position: 4, color: "#22c55e" },
      ]);
      console.log("[db] initialized default work statuses");
    }
  } catch (e) {
    console.warn("[db] could not initialize work statuses:", (e as Error).message);
  }

  // Fail loud at boot if the PII/secret encryption key is missing or broken,
  // rather than letting email/integration credentials silently fail to decrypt
  // a few seconds later (APP_ENCRYPTION_KEY, or AUTH_SECRET as fallback).
  try {
    if (decryptField(encryptField("kc-startup-check")) !== "kc-startup-check") {
      throw new Error("encryption round-trip mismatch");
    }
  } catch (err) {
    console.error(
      "[crypto] encryption self-check failed — set APP_ENCRYPTION_KEY (or AUTH_SECRET):",
      (err as Error).message,
    );
    process.exit(1);
  }

  // A fresh round-trip passes even with a WRONG key, so also verify the key can
  // decrypt EXISTING stored secrets. This catches an accidentally-changed
  // APP_ENCRYPTION_KEY at boot, before email/integrations silently treat their
  // (now unreadable) credentials as "not configured".
  let keyMismatch: string | null = null;
  try {
    const [acct] = await db
      .select({ configEnc: schema.emailAccounts.configEnc })
      .from(schema.emailAccounts)
      .where(isNotNull(schema.emailAccounts.configEnc))
      .limit(1);
    if (acct?.configEnc && !canDecrypt(acct.configEnc)) keyMismatch = "email account credentials";
    if (!keyMismatch) {
      const integ = await db.select({ config: schema.integrationConfigs.config }).from(schema.integrationConfigs);
      for (const r of integ) {
        const envEnc = (r.config as { envEnc?: string } | null)?.envEnc;
        if (envEnc && !canDecrypt(envEnc)) { keyMismatch = "integration secrets"; break; }
      }
    }
  } catch (e) {
    console.warn("[crypto] could not run the stored-secret decryption check:", (e as Error).message);
  }
  if (keyMismatch) {
    console.error(
      `[crypto] APP_ENCRYPTION_KEY does not match stored ${keyMismatch} — they cannot be decrypted. ` +
        "Restore the original key (or re-enter the credentials) and restart.",
    );
    process.exit(1);
  }

  const server = createServer((req, res) => {
    // Lightweight health check for the supervisor (PM2/NSSM) — no Next round-trip.
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, dev, ts: Date.now() }));
      return;
    }
    handle(req, res, parse(req.url!, true));
  });

  // CORS: same-origin LAN app only; reflect the requesting LAN origin.
  const io = new IOServer(server, {
    cors: { origin: true, credentials: true },
    path: "/socket.io",
  });
  setIO(io);

  // Authenticate every socket from the kc_session cookie — never trust a
  // client-supplied userId (would let any LAN device read others' notifications).
  io.use(async (socket, nextFn) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie);
      const user = await validateSessionToken(token);
      if (!user) return nextFn(new Error("UNAUTHENTICATED"));
      (socket.data as { userId?: string }).userId = user.id;
      nextFn();
    } catch (e) {
      nextFn(e as Error);
    }
  });

  io.on("connection", (socket) => {
    const userId = (socket.data as { userId?: string }).userId;
    if (userId) {
      socket.join(`user:${userId}`);
      io.emit("presence", { userId, online: true });
      socket.on("disconnect", () => io.emit("presence", { userId, online: false }));
    }
    socket.on("ping:presence", () => socket.emit("pong:presence"));
  });

  // Start the file-server watcher engine.
  startWatchers().catch((e) => console.error("[watcher] start failed:", e));
  // Compliance/recurrence/automator scheduler + inbound email poller.
  try { startScheduler(); } catch (e) { console.error("[scheduler] start failed:", e); }
  try { startEmailPoller(); } catch (e) { console.error("[email] start failed:", e); }

  // Housekeeping: prune expired staff + portal sessions on boot and every 6h.
  pruneExpiredSessions();
  pruneExpiredPortalSessions();
  setInterval(pruneExpiredSessions, 6 * 60 * 60 * 1000).unref();
  setInterval(pruneExpiredPortalSessions, 6 * 60 * 60 * 1000).unref();
  if (dev) console.warn("[server] WARNING: running in DEV mode — set NODE_ENV=production for LAN deployment.");

  // Exit clearly on a bind failure (e.g. port already in use) instead of limping
  // along in a half-started state after the uncaughtException handler logs it.
  server.on("error", (err) => {
    console.error(`[server] failed to bind ${hostname}:${port} —`, err);
    process.exit(1);
  });

  server.listen(port, hostname, () => {
    console.log(`\n  KarbonCopy ready`);
    console.log(`  ▸ Local:   http://localhost:${port}`);
    for (const ip of localIPs()) console.log(`  ▸ Network: http://${ip}:${port}`);
    console.log("");
  });

  const shutdown = async () => {
    console.log("\n[server] shutting down…");
    // Safety net: never let a lingering Socket.IO client keep the process alive.
    const force = setTimeout(() => {
      console.error("[server] shutdown timed out — forcing exit.");
      process.exit(1);
    }, 10_000);
    force.unref();
    try {
      try { stopScheduler(); } catch {}
      try { stopEmailPoller(); } catch {}
      await stopWatchers();
      await io.close();
      server.close(() => {
        clearTimeout(force);
        process.exit(0);
      });
    } catch (e) {
      console.error("[server] shutdown error:", e);
      clearTimeout(force);
      process.exit(1);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}).catch((err) => {
  // Next.js failed to prepare (bad build / missing .next / compile error).
  // Exit loudly instead of hanging without ever listening.
  console.error("[server] Next.js preparation failed — cannot start:", err);
  process.exit(1);
});
