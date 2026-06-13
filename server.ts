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
    handle(req, res, parse(req.url!, true));
  });

  const io = new IOServer(server, {
    cors: { origin: "*" },
    path: "/socket.io",
  });
  setIO(io);

  io.on("connection", (socket) => {
    const userId = socket.handshake.auth?.userId as string | undefined;
    if (userId) {
      socket.join(`user:${userId}`);
      io.emit("presence", { userId, online: true });
      socket.on("disconnect", () => io.emit("presence", { userId, online: false }));
    }
    socket.on("ping:presence", () => socket.emit("pong:presence"));
  });

  // Start the file-server watcher engine.
  startWatchers().catch((e) => console.error("[watcher] start failed:", e));

  server.listen(port, hostname, () => {
    console.log(`\n  KarbonCopy ready`);
    console.log(`  ▸ Local:   http://localhost:${port}`);
    for (const ip of localIPs()) console.log(`  ▸ Network: http://${ip}:${port}`);
    console.log("");
  });

  const shutdown = async () => {
    console.log("\n[server] shutting down…");
    await stopWatchers();
    io.close();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
