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
import { setIO } from "@/server/realtime";
import { startWatchers, stopWatchers } from "@/server/watcher";
import { startScheduler, stopScheduler } from "@/server/scheduler";
import { startEmailPoller, stopEmailPoller } from "@/server/email";
import { validateSessionToken, readCookie, pruneExpiredSessions } from "@/lib/session";

// Keep the long-lived LAN server alive through unexpected errors instead of
// crashing the whole firm's app (the observed exit -1). Log loudly.
process.on("uncaughtException", (err) => console.error("[server] uncaughtException:", err));
process.on("unhandledRejection", (err) => console.error("[server] unhandledRejection:", err));

const dev = process.env.NODE_ENV !== "production";
// NOTE: avoid HOSTNAME — shells (Git Bash) export it as the machine name,
// which dotenv won't override, causing a bad bind. Use HOST instead.
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

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

  // Housekeeping: prune expired sessions on boot and every 6h.
  pruneExpiredSessions();
  setInterval(pruneExpiredSessions, 6 * 60 * 60 * 1000).unref();
  if (dev) console.warn("[server] WARNING: running in DEV mode — set NODE_ENV=production for LAN deployment.");

  server.listen(port, hostname, () => {
    console.log(`\n  KarbonCopy ready`);
    console.log(`  ▸ Local:   http://localhost:${port}`);
    for (const ip of localIPs()) console.log(`  ▸ Network: http://${ip}:${port}`);
    console.log("");
  });

  const shutdown = async () => {
    console.log("\n[server] shutting down…");
    try { stopScheduler(); } catch {}
    try { stopEmailPoller(); } catch {}
    await stopWatchers();
    io.close();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
