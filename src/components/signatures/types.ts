import type { SignatureStatus } from "@/db/schema";

export type OrgLite = { id: string; name: string };

export type ContactLite = {
  id: string;
  firstName: string;
  lastName: string;
  organizationId: string | null;
};

export type DocLite = {
  id: string;
  name: string;
  mimeType: string | null;
  organizationId: string | null;
  createdAt: Date;
};

export type SigRow = {
  id: string;
  title: string;
  message: string | null;
  organizationId: string | null;
  contactId: string | null;
  documentId: string | null;
  status: SignatureStatus;
  magicToken: string;
  signerName: string | null;
  signedDocumentPath: string | null;
  signedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  orgName: string | null;
  docName: string | null;
};

export const STATUS_META: Record<
  SignatureStatus,
  { label: string; variant: "secondary" | "warning" | "success" | "destructive" | "outline" }
> = {
  draft: { label: "Draft", variant: "outline" },
  sent: { label: "Sent", variant: "secondary" },
  viewed: { label: "Viewed", variant: "warning" },
  signed: { label: "Signed", variant: "success" },
  declined: { label: "Declined", variant: "destructive" },
  expired: { label: "Expired", variant: "destructive" },
};

export function effectiveStatus(r: { status: SignatureStatus; expiresAt: Date | null }): SignatureStatus {
  if (
    r.expiresAt &&
    r.expiresAt.getTime() < Date.now() &&
    r.status !== "signed" &&
    r.status !== "declined"
  ) {
    return "expired";
  }
  return r.status;
}
