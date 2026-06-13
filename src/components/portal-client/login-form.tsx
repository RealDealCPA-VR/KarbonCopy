"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, LogIn, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type AuthState } from "@/app/portal/(client)/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
        </>
      ) : (
        <>
          <LogIn className="h-4 w-4" /> Sign in
        </>
      )}
    </Button>
  );
}

export function LoginForm({ firmName }: { firmName?: string | null }) {
  const [state, formAction] = useActionState<AuthState, FormData>(loginAction, undefined);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
      <header className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Client Portal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to {firmName ?? "your accounting firm"}
        </p>
      </header>

      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
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

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Trouble signing in? Contact your accountant for help.
      </p>
      <p className="mt-1 text-center text-xs text-muted-foreground">Secured by KarbonCopy</p>
    </div>
  );
}
