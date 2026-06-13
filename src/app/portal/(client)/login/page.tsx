import { redirect } from "next/navigation";
import { getPortalUser } from "@/lib/portal-auth";
import { LoginForm } from "@/components/portal-client/login-form";

export const dynamic = "force-dynamic";

// PUBLIC page — kc_portal realm only. NEVER call getCurrentUser() here.
export default async function PortalLoginPage() {
  const ctx = await getPortalUser();
  if (ctx) redirect("/portal/dashboard");

  // The firm name shown is the signed-out client's org — unknown pre-login, so
  // we keep it generic rather than leaking any org-specific text.
  return <LoginForm firmName={null} />;
}
