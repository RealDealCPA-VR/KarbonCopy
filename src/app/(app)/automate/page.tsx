import Link from "next/link";
import { ArrowLeft, ShieldAlert, Sparkles, KeyRound } from "lucide-react";
import { requireUser, hasRole } from "@/lib/auth";
import { aiEnabled } from "@/lib/ai";
import { AutomateClient } from "@/components/automate/automate-client";

export const dynamic = "force-dynamic";

export default async function AutomatePage() {
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
            Workflow generation is limited to firm owners and admins. Ask your administrator
            if you need access.
          </p>
        </div>
      </div>
    );
  }

  const enabled = aiEnabled();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/work/templates"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to templates
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles className="h-6 w-6 text-primary" />
          Generate a workflow
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Describe an engagement in plain English. Claude proposes a reviewable plan — a work
          template, its task checklist, automators, and file-server rules — grounded in your
          firm&apos;s actual statuses, work types, and people. Review, then apply.
        </p>
      </div>

      {enabled ? (
        <AutomateClient />
      ) : (
        <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-card py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <KeyRound className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">AI generation is disabled</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Set the <code className="rounded bg-muted px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code>{" "}
              environment variable to enable AI-native workflow generation, then restart the server.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
