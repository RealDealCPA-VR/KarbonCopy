import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { PortalInvalid } from "@/components/portal/portal-invalid";
import { PortalUpload } from "@/components/portal/portal-upload";

export const dynamic = "force-dynamic";

// NOTE: this is a PUBLIC page — no getCurrentUser()/requireUser() here.
export default async function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [request] = await db
    .select({
      id: schema.documentRequests.id,
      title: schema.documentRequests.title,
      message: schema.documentRequests.message,
      items: schema.documentRequests.items,
      status: schema.documentRequests.status,
      expiresAt: schema.documentRequests.expiresAt,
      orgName: schema.organizations.name,
    })
    .from(schema.documentRequests)
    .leftJoin(schema.organizations, eq(schema.documentRequests.organizationId, schema.organizations.id))
    .where(eq(schema.documentRequests.magicToken, token))
    .limit(1);

  if (!request) {
    return <PortalInvalid reason="not-found" />;
  }
  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
    return <PortalInvalid reason="expired" firmName={request.orgName} />;
  }

  const items = (request.items ?? []).map((i) => ({
    label: i.label,
    fulfilled: i.fulfilled,
  }));

  return (
    <PortalUpload
      token={token}
      title={request.title}
      message={request.message}
      firmName={request.orgName}
      items={items}
    />
  );
}
