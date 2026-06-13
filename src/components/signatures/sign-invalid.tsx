import { FileX2, Clock, Ban } from "lucide-react";

export function SignInvalid({
  reason,
  firmName,
}: {
  reason: "not-found" | "expired" | "declined";
  firmName?: string | null;
}) {
  const map = {
    "not-found": {
      Icon: FileX2,
      title: "Link not found",
      body:
        "We couldn't find a signature request for this link. It may have been removed, " +
        "or the link may be incorrect. Please contact your accountant for a new link.",
    },
    expired: {
      Icon: Clock,
      title: "This link has expired",
      body:
        "The signing window for this document has closed. Please contact your accountant " +
        "to request a new secure link.",
    },
    declined: {
      Icon: Ban,
      title: "This request was declined",
      body: "This signature request is no longer active. Please contact your accountant.",
    },
  }[reason];

  const { Icon } = map;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Icon className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold">{map.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{map.body}</p>
        <p className="mt-6 text-xs text-muted-foreground">
          {firmName ? `${firmName} · ` : ""}Secured by KarbonCopy
        </p>
      </div>
    </div>
  );
}
