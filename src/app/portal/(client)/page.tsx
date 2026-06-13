import { redirect } from "next/navigation";
import { getPortalUser } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

// /portal — route the visitor to their dashboard or the login page.
export default async function PortalIndexPage() {
  const ctx = await getPortalUser();
  redirect(ctx ? "/portal/dashboard" : "/portal/login");
}
