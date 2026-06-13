/**
 * Apply generated SQL migrations from ./drizzle.
 * For quick local dev, `pnpm db:push` is usually enough; use this for
 * reproducible production deploys.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./index";

try {
  migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ Migrations applied.");
} catch (e) {
  console.error("Migration failed:", e);
  process.exit(1);
}
