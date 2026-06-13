// No-op stub. Mapped over the "server-only"/"client-only" marker packages for
// the tsx-run custom server (server.ts), which loads app modules OUTSIDE Next's
// bundler where those markers would throw. Next's build still uses the real
// packages (via tsconfig.json), so the client/server guard remains enforced.
export {};
