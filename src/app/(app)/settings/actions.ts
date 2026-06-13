"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin, invalidateUserSessions } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import type {
  AutomatorAction,
  AutomatorTrigger,
  FileRuleEvent,
  UserRole,
} from "@/db/schema";

const { watchedRoots, fileRules, users, automators, settings, activities } = schema;

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function audit(actorId: string, verb: string, summary: string) {
  try {
    await db.insert(activities).values({
      actorId,
      verb,
      entityKind: "document",
      entityId: "settings",
      summary,
    });
  } catch {
    /* best-effort */
  }
}

function fail(err: unknown): { ok: false; error: string } {
  const msg = (err as Error)?.message ?? "Something went wrong";
  if (msg === "FORBIDDEN") return { ok: false, error: "Admin access required" };
  if (msg === "UNAUTHENTICATED") return { ok: false, error: "Please sign in" };
  return { ok: false, error: msg };
}

/* ------------------------------------------------------------------ */
/* Watched roots                                                       */
/* ------------------------------------------------------------------ */

export async function createWatchedRoot(input: {
  label: string;
  path: string;
  enabled: boolean;
  matchOrgByFolder: boolean;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    if (!input.label.trim() || !input.path.trim())
      return { ok: false, error: "Label and path are required" };
    const [row] = await db
      .insert(watchedRoots)
      .values({
        label: input.label.trim(),
        path: input.path.trim(),
        enabled: input.enabled,
        matchOrgByFolder: input.matchOrgByFolder,
      })
      .returning({ id: watchedRoots.id });
    await audit(user.id, "created", `Added watched folder “${input.label}”`);
    revalidatePath("/settings");
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function updateWatchedRoot(
  id: string,
  patch: Partial<{ label: string; path: string; enabled: boolean; matchOrgByFolder: boolean }>,
): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    await db.update(watchedRoots).set(patch).where(eq(watchedRoots.id, id));
    await audit(user.id, "updated", `Updated watched folder`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteWatchedRoot(id: string): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    await db.delete(watchedRoots).where(eq(watchedRoots.id, id));
    await audit(user.id, "deleted", `Removed watched folder`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------------ */
/* File rules                                                          */
/* ------------------------------------------------------------------ */

export async function createFileRule(input: {
  rootId: string;
  name: string;
  globPattern: string;
  event: FileRuleEvent;
  notify: string[] | string;
  message: string;
  severity: "info" | "success" | "warning";
  enabled: boolean;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    if (!input.name.trim() || !input.globPattern.trim() || !input.rootId)
      return { ok: false, error: "Name, pattern and root are required" };
    const [row] = await db
      .insert(fileRules)
      .values({
        rootId: input.rootId,
        name: input.name.trim(),
        globPattern: input.globPattern.trim(),
        event: input.event,
        notify: input.notify,
        message: input.message.trim() || null,
        severity: input.severity,
        enabled: input.enabled,
      })
      .returning({ id: fileRules.id });
    await audit(user.id, "created", `Added file rule “${input.name}”`);
    revalidatePath("/settings");
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function updateFileRule(
  id: string,
  patch: Partial<{
    name: string;
    globPattern: string;
    event: FileRuleEvent;
    notify: string[] | string;
    message: string | null;
    severity: "info" | "success" | "warning";
    enabled: boolean;
  }>,
): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    await db.update(fileRules).set(patch).where(eq(fileRules.id, id));
    await audit(user.id, "updated", `Updated file rule`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteFileRule(id: string): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    await db.delete(fileRules).where(eq(fileRules.id, id));
    await audit(user.id, "deleted", `Removed file rule`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------------ */
/* Users & roles                                                       */
/* ------------------------------------------------------------------ */

const VALID_ROLES: UserRole[] = ["owner", "admin", "manager", "staff", "readonly"];

export async function createUser(input: {
  name: string;
  email: string;
  role: UserRole;
  password: string;
  weeklyCapacityMinutes?: number;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name || !email) return { ok: false, error: "Name and email are required" };
    if (!input.password || input.password.length < 6)
      return { ok: false, error: "Password must be at least 6 characters" };
    if (!VALID_ROLES.includes(input.role)) return { ok: false, error: "Invalid role" };

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) return { ok: false, error: "A user with that email already exists" };

    const [row] = await db
      .insert(users)
      .values({
        name,
        email,
        role: input.role,
        passwordHash: hashPassword(input.password),
        weeklyCapacityMinutes: input.weeklyCapacityMinutes ?? 2400,
      })
      .returning({ id: users.id });
    await audit(user.id, "created", `Added user ${name} (${input.role})`);
    revalidatePath("/settings");
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function updateUser(
  id: string,
  patch: Partial<{ role: UserRole; active: boolean; weeklyCapacityMinutes: number; name: string }>,
): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    if (patch.role && !VALID_ROLES.includes(patch.role))
      return { ok: false, error: "Invalid role" };
    // guard: don't let an admin lock themselves out of their own account
    if (id === user.id && patch.active === false)
      return { ok: false, error: "You can't deactivate your own account" };
    await db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, id));
    // Force re-auth if the user's role or active status changed (demoted/deactivated
    // users should be logged out everywhere). Never invalidate the acting admin's own
    // sessions — the self-deactivate guard above already prevents that case.
    if ((patch.role !== undefined || patch.active !== undefined) && id !== user.id) {
      await invalidateUserSessions(id);
    }
    await audit(user.id, "updated", `Updated user`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function resetUserPassword(id: string, password: string): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    if (!password || password.length < 6)
      return { ok: false, error: "Password must be at least 6 characters" };
    await db
      .update(users)
      .set({ passwordHash: hashPassword(password), updatedAt: new Date() })
      .where(eq(users.id, id));
    // Log the user out everywhere so the old password's sessions can't continue.
    // Skip self so the admin isn't kicked out mid-reset (they keep their session).
    if (id !== user.id) {
      await invalidateUserSessions(id);
    }
    await audit(user.id, "updated", `Reset a user password`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------------ */
/* Automators                                                          */
/* ------------------------------------------------------------------ */

export async function createAutomator(input: {
  name: string;
  trigger: AutomatorTrigger;
  action: AutomatorAction;
  enabled: boolean;
  conditions?: Record<string, unknown>;
  actionParams?: Record<string, unknown>;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    if (!input.name.trim()) return { ok: false, error: "Name is required" };
    const [row] = await db
      .insert(automators)
      .values({
        name: input.name.trim(),
        trigger: input.trigger,
        action: input.action,
        enabled: input.enabled,
        conditions: input.conditions ?? {},
        actionParams: input.actionParams ?? {},
      })
      .returning({ id: automators.id });
    await audit(user.id, "created", `Added automator “${input.name}”`);
    revalidatePath("/settings");
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function updateAutomator(
  id: string,
  patch: Partial<{
    name: string;
    enabled: boolean;
    trigger: AutomatorTrigger;
    action: AutomatorAction;
    conditions: Record<string, unknown>;
    actionParams: Record<string, unknown>;
  }>,
): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    await db.update(automators).set(patch).where(eq(automators.id, id));
    await audit(user.id, "updated", `Updated automator`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteAutomator(id: string): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    await db.delete(automators).where(eq(automators.id, id));
    await audit(user.id, "deleted", `Removed automator`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------------ */
/* Firm settings (key/value)                                           */
/* ------------------------------------------------------------------ */

export async function saveSetting(key: string, value: unknown): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    if (!key.trim()) return { ok: false, error: "Key is required" };
    await db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await audit(user.id, "updated", `Updated firm setting “${key}”`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
