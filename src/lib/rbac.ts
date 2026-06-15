/**
 * Pure role logic — safe to import anywhere (Next, the tsx custom server, the
 * standalone MCP process). No server-only, no db, no next/headers.
 */
import type { User, UserRole } from "@/db/schema";

export const ROLE_RANK: Record<UserRole, number> = {
  readonly: 0,
  staff: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

export function hasRole(user: Pick<User, "role">, min: UserRole): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[min];
}
