import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 + chokidar are native/node-only — keep them server-external
  serverExternalPackages: ["better-sqlite3", "chokidar"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // In dev, the app writes to ./data at runtime (SQLite db/-wal/-shm, uploads).
  // Those live under the project root, so the default webpack dev watcher picks up
  // each write → recompiles → SSR touches the db again → more writes → infinite
  // recompile loop that eventually crashes the process. Exclude runtime-write dirs.
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.next/**", "**/data/**"],
      };
    }
    return config;
  },
};

export default nextConfig;
