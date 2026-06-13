import { FileX2, Clock } from "lucide-react";

export function PortalInvalid({
  reason,
  firmName,
}: {
  reason: "not-found" | "expired";
  firmName?: string | null;
}) {
  const expired = reason === "expired";
  const Icon = expired ? Clock : FileX2;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Icon className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold">
          {expired ? "This link has expired" : "Link not found"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {expired
            ? "The upload window for this document request has closed. Please contact your accountant to request a new secure link."
            : "We couldn't find a document request for this link. It may have been removed, or the link may be incorrect."}
        </p>
        <p className="mt-6 text-xs text-muted-foreground">
          {firmName ? `${firmName} · ` : ""}Secured by KarbonCopy
        </p>
      </div>
    </div>
  );
}
