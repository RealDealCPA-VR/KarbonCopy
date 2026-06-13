import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./data/karboncopy.db";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

const dbPath = resolveDbPath();
mkdirSync(dirname(dbPath), { recursive: true });

// Reuse the connection across HMR reloads in dev.
const globalForDb = globalThis as unknown as { __sqlite?: Database.Database };

const sqlite =
  globalForDb.__sqlite ??
  (() => {
    const conn = new Database(dbPath);
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    conn.pragma("busy_timeout = 5000");
    return conn;
  })();

if (process.env.NODE_ENV !== "production") globalForDb.__sqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { schema };
export type DB = typeof db;
