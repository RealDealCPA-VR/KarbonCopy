import "server-only";
import { redirect } from "next/navigation";
import { getPortalUser, type PortalContext } from "@/lib/portal-auth";

/**
 * Page-level guard for the authenticated (client) area. Resolves the portal
 * context or redirects to /portal/login. Use at the top of every (client) page
 * instead of bare requirePortalUser() so the unauthenticated path is a clean
 * redirect rather than a thrown error.
 */
export async function guardPortal(): Promise<PortalContext> {
  const ctx = await getPortalUser();
  if (!ctx) redirect("/portal/login");
  return ctx;
}
