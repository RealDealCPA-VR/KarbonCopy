/**
 * PM2 process definition for KarbonCopy.
 *
 * Runs the unified server (Next + Socket.IO + watcher) as an always-on,
 * auto-restarting service in production. PM2 invokes `pnpm start`
 * (= cross-env NODE_ENV=production tsx server.ts), which binds 0.0.0.0:3000.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * See OPS.md for the full runbook (startup-on-boot, NSSM alternative,
 * log rotation, backups).
 */
module.exports = {
  apps: [
    {
      name: "karboncopy",
      script: "pnpm",
      args: "start",
      // On Windows, run pnpm through the shell so PM2 resolves the .cmd shim.
      windowsHide: true,
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOST: "0.0.0.0",
      },
      autorestart: true,
      max_restarts: 10,
      // If it crashes 10x within this window, stop trying (avoids crash loops).
      min_uptime: "30s",
      restart_delay: 3000,
      // Prepend timestamps to every log line.
      time: true,
      error_file: "./logs/karboncopy-error.log",
      out_file: "./logs/karboncopy-out.log",
      merge_logs: true,
      // The watcher + SQLite hold state in one process; keep a single instance.
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1G",
    },
  ],
};
