# KarbonCopy — Operations Runbook

Self-hosted, single-process LAN deployment (Next + Socket.IO + file watcher) bound
to `0.0.0.0:3000`. This document covers running it as an always-on service, backups,
and log rotation.

> **Prereqs (first run):** `pnpm install`, then `pnpm build`. Set `AUTH_SECRET` +
> `APP_ENCRYPTION_KEY` in `.env.local`. The server **auto-applies migrations and
> seeds the default work statuses on boot**, but you must run **`pnpm db:seed`
> once** to create the initial admin login (`admin@firm.com` / `admin123`) and demo
> data — without it you cannot sign in. Then start with `pnpm start`
> (= `NODE_ENV=production tsx server.ts`). Health endpoint: `GET /healthz` returns
> `{ ok: true, dev: false }` when healthy.

---

## 1. Always-on service

Pick **one** supervisor. PM2 is the default; NSSM is the native-Windows-service
alternative. Do not run both for the same app.

### Option A — PM2 (recommended)

```powershell
# Install PM2 globally (once).
pnpm add -g pm2

# Start KarbonCopy from the project root using the bundled config.
pm2 start ecosystem.config.cjs

# Persist the current process list so it survives `pm2 resurrect`.
pm2 save

# Make PM2 itself start on boot.
#  - Windows: use pm2-startup (installs a boot task that resurrects the saved list)
pnpm add -g pm2-windows-startup
pm2-startup install
#  - Linux/macOS equivalent: `pm2 startup` then run the printed command, then `pm2 save`
```

Useful commands:

```powershell
pm2 status                 # process table + restarts + uptime
pm2 logs karboncopy        # tail combined logs
pm2 restart karboncopy     # restart after a deploy
pm2 reload karboncopy      # zero-downtime reload (single instance: same as restart)
pm2 stop karboncopy
pm2 delete karboncopy      # remove from PM2 (then `pm2 save`)
```

After every deploy: `pm2 restart karboncopy && pm2 save`.

### Option B — NSSM (native Windows service)

NSSM wraps `pnpm start` as a Windows Service (auto-starts on boot, restarts on crash,
visible in `services.msc`).

> Replace `<KARBONCOPY_ROOT>` below with your actual install path
> (e.g. `C:\Users\you\KarbonCopy`).

```powershell
# Install NSSM (e.g. via scoop/choco) then register the service.
# Point Application at the pnpm shim and pass `start`; set the working dir.
nssm install KarbonCopy "C:\Program Files\nodejs\pnpm.cmd" start
nssm set KarbonCopy AppDirectory "<KARBONCOPY_ROOT>"
nssm set KarbonCopy AppEnvironmentExtra NODE_ENV=production PORT=3000 HOST=0.0.0.0

# Log redirection (NSSM writes the process stdout/stderr to files).
nssm set KarbonCopy AppStdout "<KARBONCOPY_ROOT>\logs\karboncopy-out.log"
nssm set KarbonCopy AppStderr "<KARBONCOPY_ROOT>\logs\karboncopy-error.log"

# Restart on crash; start automatically at boot.
nssm set KarbonCopy AppExit Default Restart
nssm set KarbonCopy Start SERVICE_AUTO_START

nssm start KarbonCopy
# Manage later: nssm restart KarbonCopy | nssm stop KarbonCopy | nssm remove KarbonCopy confirm
```

> Confirm the `pnpm.cmd` path with `(Get-Command pnpm).Source`. If pnpm is installed
> per-user (e.g. via Corepack), point NSSM at that path instead.

---

## 2. Log rotation

Logs accumulate under `./logs/` (gitignored). Rotate them so they don't grow without bound.

### With PM2

```powershell
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M       # rotate at 10 MB
pm2 set pm2-logrotate:retain 14          # keep 14 rotated files
pm2 set pm2-logrotate:compress true      # gzip rotated logs
pm2 set pm2-logrotate:rotateInterval "0 0 * * *"   # also rotate daily at midnight
```

### With NSSM

NSSM has built-in online rotation for the redirected stdout/stderr files:

```powershell
nssm set KarbonCopy AppRotateFiles 1
nssm set KarbonCopy AppRotateOnline 1
nssm set KarbonCopy AppRotateBytes 10485760   # rotate at 10 MB
```

---

## 3. Database backups

`scripts/backup.mjs` takes a consistent **online** snapshot of `data/karboncopy.db`
(via better-sqlite3 `.backup()`), WAL-checkpoints the live DB, writes
`data/backups/karboncopy-<ISO>.db`, and prunes backups older than **30 days**. It is
safe to run while the server is live.

```powershell
pnpm backup
```

### Schedule it daily (Windows Task Scheduler)

Run as the **same account** that runs the server, from the project root:

```bat
:: Replace <KARBONCOPY_ROOT> with your actual install path.
schtasks /Create /SC DAILY /ST 02:00 /TN "KarbonCopy Backup" ^
  /TR "cmd /c cd /d <KARBONCOPY_ROOT> && pnpm backup >> logs\backup.log 2>&1"
```

Verify / inspect / remove:

```powershell
schtasks /Query /TN "KarbonCopy Backup" /V /FO LIST
schtasks /Run   /TN "KarbonCopy Backup"      # run once now to test
schtasks /Delete /TN "KarbonCopy Backup" /F
```

### Restore

1. Stop the service (`pm2 stop karboncopy` or `nssm stop KarbonCopy`).
2. Move the chosen `data/backups/karboncopy-<ISO>.db` to `data/karboncopy.db`
   (back up the current file first). The backup is consolidated — no `-wal`/`-shm`
   files are required.
3. Start the service again and confirm `/healthz`.

### Migrate-with-backup runbook

Always snapshot before a schema migration:

```powershell
pnpm backup            # snapshot first
pm2 stop karboncopy    # (or nssm stop KarbonCopy)
pnpm db:migrate        # apply ./drizzle migrations
pm2 start karboncopy   # (or nssm start KarbonCopy)
```

If the migration fails, restore the snapshot per the Restore steps above.

---

## 4. Directories

- `./logs/` — service stdout/stderr + `backup.log` (gitignored).
- `./data/` — SQLite DB, uploads, and `data/backups/` (gitignored).
- `DATA_DIR` / `DATABASE_URL` — override the DB location via env if data lives off the
  project tree; `scripts/backup.mjs` honors `DATABASE_URL`.
