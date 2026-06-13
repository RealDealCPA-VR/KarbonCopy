import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { PortalInvalid } from "@/components/portal/portal-invalid";
import { AcceptInviteForm } from "@/components/portal-client/accept-invite-form";

export const dynamic = "force-dynamic";

// PUBLIC page — invite acceptance via portalUsers.inviteToken. No staff auth.
export default async function PortalAcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) return <PortalInvalid reason="not-found" />;

  const [pu] = await db
    .select({
      id: schema.portalUsers.id,
      email: schema.portalUsers.email,
      active: schema.portalUsers.active,
      inviteToken: schema.portalUsers.inviteToken,
      inviteExpiresAt: schema.portalUsers.inviteExpiresAt,
      orgName: schema.organizations.name,
    })
    .from(schema.portalUsers)
    .leftJoin(schema.contacts, eq(schema.portalUsers.contactId, schema.contacts.id))
    .leftJoin(schema.organizations, eq(schema.contacts.organizationId, schema.organizations.id))
    .where(eq(schema.portalUsers.inviteToken, token))
    .limit(1);

  if (!pu || !pu.active) return <PortalInvalid reason="not-found" />;
  if (pu.inviteExpiresAt && pu.inviteExpiresAt.getTime() < Date.now()) {
    return <PortalInvalid reason="expired" firmName={pu.orgName} />;
  }

  return <AcceptInviteForm token={token} email={pu.email} firmName={pu.orgName} />;
}
