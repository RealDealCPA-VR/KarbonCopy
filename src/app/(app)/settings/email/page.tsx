import { Mail, ShieldAlert } from "lucide-react";
import { requireUser, hasRole } from "@/lib/auth";
import { listSafeAccounts } from "@/lib/email/accounts";
import { EmailAccountsManager } from "./email-accounts-manager";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  const user = await requireUser();

  if (!hasRole(user, "admin")) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warning/15 text-warning">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Admin access required</h1>
          <p className="mt-1 text-muted-foreground">
            Email account configuration is limited to firm owners and admins.
          </p>
        </div>
      </div>
    );
  }

  const accounts = await listSafeAccounts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Mail className="h-6 w-6 text-primary" />
          Email accounts
        </h1>
        <p className="text-muted-foreground">
          Connect your firm mailbox so the Triage inbox can send and receive real client
          email. Credentials are encrypted at rest and never leave your server.
        </p>
      </div>

      <EmailAccountsManager initialAccounts={accounts} />
    </div>
  );
}
