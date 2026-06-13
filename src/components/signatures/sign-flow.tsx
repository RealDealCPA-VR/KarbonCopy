"use client";

import * as React from "react";
import {
  ShieldCheck, FileText, CheckCircle2, AlertCircle, Loader2, Download, PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SignaturePad } from "./signature-pad";

export function SignFlow({
  token,
  title,
  message,
  firmName,
  docName,
  suggestedName,
  alreadySigned = false,
  signedName = null,
  signedAt = null,
}: {
  token: string;
  title: string;
  message: string | null;
  firmName: string | null;
  docName: string | null;
  suggestedName: string | null;
  alreadySigned?: boolean;
  signedName?: string | null;
  signedAt?: string | null;
}) {
  const [name, setName] = React.useState(suggestedName ?? "");
  const [tab, setTab] = React.useState<"type" | "draw">("type");
  const [drawn, setDrawn] = React.useState<string | null>(null);
  const [consent, setConsent] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(alreadySigned);
  const [error, setError] = React.useState<string | null>(null);

  const canSubmit =
    name.trim().length >= 2 && consent && (tab === "type" || drawn != null) && !submitting;

  async function submit() {
    setError(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signerName: name.trim(),
          drawnSignature: tab === "draw" ? drawn : null,
          consent: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "We couldn't record your signature. Please try again.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-success/10 text-success">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Signature recorded</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Thank you{signedName ? `, ${signedName}` : ""}. Your signature for{" "}
          <span className="font-medium text-foreground">{title}</span> has been recorded
          {signedAt ? ` on ${new Date(signedAt).toLocaleString()}` : ""}. Your accountant has
          been notified.
        </p>
        <Button asChild className="mt-6">
          <a href={`/api/portal/sign/${token}/signed`} target="_blank" rel="noreferrer">
            <Download className="h-4 w-4" /> Download signed PDF
          </a>
        </Button>
        <p className="mt-10 text-xs text-muted-foreground">
          {firmName ? `${firmName} · ` : ""}Secured by KarbonCopy
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-10 sm:py-16">
      <header className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <PenLine className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">{firmName ?? "Your accountant"}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{title}</h1>
        {message && (
          <p className="mx-auto mt-3 max-w-prose text-sm text-muted-foreground">{message}</p>
        )}
      </header>

      {/* Document context */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border bg-card p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{docName ?? "Document to sign"}</p>
          <p className="text-xs text-muted-foreground">PDF · review before signing</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/portal/sign/${token}/document`} target="_blank" rel="noreferrer">
            Review
          </a>
        </Button>
      </div>

      {/* Signature input */}
      <div className="space-y-5 rounded-xl border bg-card p-5">
        <div className="space-y-1.5">
          <Label htmlFor="signer-name">Full legal name</Label>
          <Input
            id="signer-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jordan A. Smith"
            autoComplete="name"
          />
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "type" | "draw")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="type">Type</TabsTrigger>
            <TabsTrigger value="draw">Draw</TabsTrigger>
          </TabsList>
          <TabsContent value="type" className="mt-3">
            <div className="flex h-[120px] items-center justify-center rounded-lg border bg-white px-4">
              <span
                className="truncate text-3xl text-[#0f1115]"
                style={{ fontFamily: "'Segoe Script', 'Brush Script MT', cursive" }}
              >
                {name.trim() || "Your signature"}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Your typed name will be applied as your signature.
            </p>
          </TabsContent>
          <TabsContent value="draw" className="mt-3">
            <SignaturePad onChange={setDrawn} />
          </TabsContent>
        </Tabs>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-muted/40 p-3 text-sm">
          <Checkbox
            checked={consent}
            onCheckedChange={(v) => setConsent(v === true)}
            className="mt-0.5"
          />
          <span className="text-muted-foreground">
            I agree to sign this document electronically and to be legally bound by my electronic
            signature, and I consent to conduct this transaction electronically.
          </span>
        </label>

        {error && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <Button className="w-full" size="lg" disabled={!canSubmit} onClick={submit}>
          {submitting ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Signing…</>
          ) : (
            <>Sign document</>
          )}
        </Button>
      </div>

      <footer className="mt-auto pt-10 text-center text-xs text-muted-foreground">
        <p className="flex items-center justify-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />
          A tamper-evident audit trail of this signing is kept by your accounting firm.
        </p>
        <p className="mt-1">Secured by KarbonCopy</p>
      </footer>
    </div>
  );
}
