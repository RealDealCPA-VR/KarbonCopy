"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, KeyRound, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInviteAction, type AuthState } from "@/app/portal/(client)/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Setting up…
        </>
      ) : (
        <>
          <KeyRound className="h-4 w-4" /> Set password & continue
        </>
      )}
    </Button>
  );
}

export function AcceptInviteForm({
  token,
  email,
  firmName,
}: {
  token: string;
  email?: string | null;
  firmName?: string | null;
}) {
  const [state, formAction] = useActionState<AuthState, FormData>(
    acceptInviteAction,
    undefined,
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
      <header className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome to the portal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a password to access {firmName ?? "your accounting firm"}.
        </p>
      </header>

      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />

          {email && (
            <div className="space-y-1.5">
              <Label htmlFor="email-display">Email</Label>
              <Input id="email-display" value={email} disabled readOnly />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              autoFocus
              placeholder="At least 8 characters"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="Re-enter your password"
            />
          </div>

          {state?.error && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /> {state.error}
            </p>
          )}

          <SubmitButton />
        </form>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">Secured by KarbonCopy</p>
    </div>
  );
}
