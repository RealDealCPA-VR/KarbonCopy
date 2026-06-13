"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  PenLine, Plus, Copy, Check, ExternalLink, Trash2, Clock, Send,
  FileSignature, ShieldCheck, Download, UploadCloud, Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  createSignatureRequest, sendSignatureRequest, deleteSignatureRequest,
} from "@/app/(app)/signatures/actions";
import {
  STATUS_META, effectiveStatus,
  type SigRow, type OrgLite, type ContactLite, type DocLite,
} from "./types";

export function SignaturesView({
  requests,
  orgs,
  contacts,
  docs,
  appUrl,
}: {
  requests: SigRow[];
  orgs: OrgLite[];
  contacts: ContactLite[];
  docs: DocLite[];
  appUrl: string;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);

  // Live refresh when a client views or signs via the public page.
  useRealtimeEvent("signature_event", () => router.refresh());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FileSignature className="h-6 w-6 text-primary" /> Signatures
          </h1>
          <p className="text-muted-foreground">
            Send 8879s and engagement letters for secure, on-premise e-signature — no third party.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New request
        </Button>
      </div>

      {requests.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <PenLine className="h-7 w-7" />
            </div>
            <div>
              <p className="font-semibold">No signature requests yet</p>
              <p className="text-sm text-muted-foreground">
                Create a request to get a secure signing link for your client.
              </p>
            </div>
            <Button className="mt-1" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New request
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} appUrl={appUrl} onChanged={() => router.refresh()} />
          ))}
        </div>
      )}

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        orgs={orgs}
        contacts={contacts}
        docs={docs}
        appUrl={appUrl}
        onCreated={() => router.refresh()}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Request card                                                       */
/* ------------------------------------------------------------------ */

function RequestCard({
  request: r,
  appUrl,
  onChanged,
}: {
  request: SigRow;
  appUrl: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const status = effectiveStatus(r);
  const meta = STATUS_META[status];
  const url = `${appUrl}/portal/sign/${r.magicToken}`;
  const signable = status === "draft" || status === "sent" || status === "viewed";

  async function onSend() {
    setBusy(true);
    const fd = new FormData();
    fd.set("id", r.id);
    const res = await sendSignatureRequest(fd);
    setBusy(false);
    if (res.ok) {
      toast.success("Marked as sent");
      onChanged();
    } else toast.error(res.error);
  }

  async function onDelete() {
    setBusy(true);
    const fd = new FormData();
    fd.set("id", r.id);
    const res = await deleteSignatureRequest(fd);
    setBusy(false);
    if (res.ok) {
      toast.success("Request deleted");
      onChanged();
    } else toast.error(res.error);
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{r.title}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {r.orgName ?? "No client"} · {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
            </div>
          </div>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>

        {r.docName && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileSignature className="h-4 w-4 shrink-0" />
            <span className="truncate">{r.docName}</span>
          </div>
        )}

        {r.message && <p className="line-clamp-2 text-sm text-muted-foreground">{r.message}</p>}

        {status === "signed" ? (
          <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <ShieldCheck className="h-4 w-4 text-success" />
              Signed by {r.signerName ?? "client"}
            </div>
            {r.signedAt && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {format(new Date(r.signedAt), "PPp")}
              </div>
            )}
          </div>
        ) : (
          r.expiresAt && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {r.expiresAt.getTime() < Date.now()
                ? "Expired"
                : `Expires ${formatDistanceToNow(r.expiresAt, { addSuffix: true })}`}
            </div>
          )
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {status === "signed" ? (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/portal/sign/${r.magicToken}/signed`} target="_blank" rel="noreferrer">
                <Download className="h-3.5 w-3.5" /> Signed PDF
              </a>
            </Button>
          ) : (
            <>
              <CopyLinkButton url={url} />
              <Button variant="outline" size="sm" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
              </Button>
              {status === "draft" && (
                <Button size="sm" onClick={onSend} disabled={busy}>
                  <Send className="h-3.5 w-3.5" /> Send
                </Button>
              )}
            </>
          )}
          {signable && (
            <Button variant="ghost" size="sm" asChild className="text-xs">
              <a href={`${url}#audit`} target="_blank" rel="noreferrer">
                Audit
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            disabled={busy}
            aria-label="Delete request"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Signing link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy link");
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={copy}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Create dialog                                                      */
/* ------------------------------------------------------------------ */

function CreateDialog({
  open,
  onOpenChange,
  orgs,
  contacts,
  docs,
  appUrl,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgs: OrgLite[];
  contacts: ContactLite[];
  docs: DocLite[];
  appUrl: string;
  onCreated: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [orgId, setOrgId] = React.useState("");
  const [contactId, setContactId] = React.useState("none");
  const [expiry, setExpiry] = React.useState("14");
  // Source: pick an existing PDF, or upload a fresh one.
  const [mode, setMode] = React.useState<"pick" | "upload">("pick");
  const [docId, setDocId] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setOrgId("");
      setContactId("none");
      setExpiry("14");
      setMode(docs.length ? "pick" : "upload");
      setDocId("");
      setFile(null);
    }
  }, [open, docs.length]);

  const orgContacts = contacts.filter((c) => c.organizationId === orgId);
  const orgDocs = orgId ? docs.filter((d) => d.organizationId === orgId || !d.organizationId) : docs;

  async function uploadFreshPdf(): Promise<string | null> {
    if (!file) return null;
    setUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    if (orgId) fd.set("organizationId", orgId);
    try {
      const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Upload failed.");
        return null;
      }
      return json.document?.id ?? null;
    } catch {
      toast.error("Network error while uploading.");
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!orgId) {
      toast.error("Pick a client.");
      return;
    }
    let documentId = docId;
    if (mode === "upload") {
      if (!file) {
        toast.error("Choose a PDF to upload.");
        return;
      }
      const uploaded = await uploadFreshPdf();
      if (!uploaded) return;
      documentId = uploaded;
    } else if (!documentId) {
      toast.error("Pick a document to be signed.");
      return;
    }

    const fd = new FormData(e.currentTarget);
    fd.set("organizationId", orgId);
    fd.set("contactId", contactId === "none" ? "" : contactId);
    fd.set("documentId", documentId);
    fd.set("expiresInDays", expiry === "never" ? "" : expiry);

    setPending(true);
    const res = await createSignatureRequest(fd);
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if ("data" in res && res.data) {
      try {
        await navigator.clipboard.writeText(`${appUrl}/portal/sign/${res.data.token}`);
        toast.success("Request created — signing link copied");
      } catch {
        toast.success("Request created");
      }
    }
    onOpenChange(false);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New signature request</DialogTitle>
          <DialogDescription>
            Pick a client and the PDF to be signed. A secure signing link is generated.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sig-title">Title *</Label>
            <Input
              id="sig-title"
              name="title"
              required
              autoFocus
              placeholder="e.g. 2024 Form 8879 — e-file authorization"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <Select value={orgId} onValueChange={(v) => { setOrgId(v); setContactId("none"); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Contact (signer)</Label>
              <Select value={contactId} onValueChange={setContactId} disabled={!orgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {orgContacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Source document */}
          <div className="space-y-2">
            <Label>Document to sign *</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "pick" ? "default" : "outline"}
                onClick={() => setMode("pick")}
                disabled={docs.length === 0}
              >
                From library
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "upload" ? "default" : "outline"}
                onClick={() => setMode("upload")}
              >
                Upload PDF
              </Button>
            </div>

            {mode === "pick" ? (
              <Select value={docId} onValueChange={setDocId}>
                <SelectTrigger>
                  <SelectValue placeholder={docs.length ? "Select a PDF" : "No PDFs available"} />
                </SelectTrigger>
                <SelectContent>
                  {orgDocs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-sm transition-colors hover:border-primary",
                  file && "border-primary/50 bg-primary/5",
                )}
              >
                <UploadCloud className="h-5 w-5 text-muted-foreground" />
                <span className="truncate">{file ? file.name : "Choose a PDF file…"}</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  hidden
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sig-message">Message to signer</Label>
            <Textarea
              id="sig-message"
              name="message"
              rows={2}
              placeholder="Please review and sign your e-file authorization…"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Link expires</Label>
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">In 7 days</SelectItem>
                <SelectItem value="14">In 14 days</SelectItem>
                <SelectItem value="30">In 30 days</SelectItem>
                <SelectItem value="never">Never</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || uploading}>
              {pending || uploading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</>
              ) : (
                "Create & copy link"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
