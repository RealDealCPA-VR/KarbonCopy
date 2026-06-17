/**
 * Online SQLite backup for KarbonCopy.
 *
 * Uses better-sqlite3's `.backup()` API, which performs a consistent online
 * snapshot while the prod server (:3000) keeps the DB open in WAL mode — no
 * downtime, no torn reads. Backups land in data/backups/ as
 * karboncopy-<ISO>.db. We also WAL-checkpoint the live DB and copy the backup's
 * own WAL/SHM so a restore is self-contained.
 *
 * Run: pnpm backup   (or: node scripts/backup.mjs)
 *
 * Windows Task Scheduler (daily 02:00) — run from the project root:
 *   schtasks /Create /SC DAILY /ST 02:00 /TN "KarbonCopy Backup" ^
 *     /TR "cmd /c cd /d <KARBONCOPY_ROOT> && pnpm backup >> logs\backup.log 2>&1"
 * (Adjust the path; use the same account that runs the server. Verify with
 *  `schtasks /Query /TN "KarbonCopy Backup"`.)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import Database from "better-sqlite3";
import { mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RETENTION_DAYS = 30;

function resolveDbPath() {
  const url = process.env.DATABASE_URL ?? "file:./data/karboncopy.db";
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  return resolve(raw);
}

function isoStamp() {
  // Filesystem-safe ISO (no colons): 2026-06-13T02-00-00-123Z
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  // Ensure ./logs exists so a scheduled `pnpm backup >> logs\backup.log` doesn't
  // fail to open its redirect target on a fresh install (before the server has
  // run). Created relative to the cwd the scheduled task runs from.
  try { mkdirSync(join(process.cwd(), "logs"), { recursive: true }); } catch {}

  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    console.error(`[backup] DB not found at ${dbPath}`);
    process.exit(1);
  }

  const dataDir = dirname(dbPath);
  const backupDir = join(dataDir, "backups");
  mkdirSync(backupDir, { recursive: true });

  const dest = join(backupDir, `karboncopy-${isoStamp()}.db`);

  // Open read-only-ish; WAL checkpoint the live DB so the snapshot is current,
  // then take the online backup.
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 10000");
  try {
    db.pragma("wal_checkpoint(PASSIVE)");
    await db.backup(dest);
  } finally {
    db.close();
  }

  // The backup is a single consolidated file, but if a WAL/SHM was produced
  // alongside it, fold it in so the restore needs only the .db.
  for (const ext of ["-wal", "-shm"]) {
    const side = dest + ext;
    if (existsSync(side)) {
      try {
        const b = new Database(dest);
        b.pragma("wal_checkpoint(TRUNCATE)");
        b.close();
      } catch (e) {
        console.warn(`[backup] could not checkpoint ${side}:`, e?.message ?? e);
      }
    }
  }

  const sizeMb = (statSync(dest).size / 1_048_576).toFixed(2);
  console.log(`[backup] wrote ${dest} (${sizeMb} MB)`);

  // Prune backups older than RETENTION_DAYS.
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  let pruned = 0;
  for (const name of readdirSync(backupDir)) {
    if (!/^karboncopy-.*\.db(-wal|-shm)?$/.test(name)) continue;
    const full = join(backupDir, name);
    if (statSync(full).mtimeMs < cutoff) {
      unlinkSync(full);
      pruned++;
    }
  }
  if (pruned) console.log(`[backup] pruned ${pruned} file(s) older than ${RETENTION_DAYS} days`);
}

main().catch((e) => {
  console.error("[backup] failed:", e);
  process.exit(1);
});
