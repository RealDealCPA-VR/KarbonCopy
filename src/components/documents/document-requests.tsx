"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Inbox, Plus, Copy, Check, ArrowLeft, Trash2, ExternalLink, Clock, X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { createDocumentRequest, deleteDocumentRequest } from "@/app/(app)/documents/actions";
import type { OrgLite } from "./types";
import type { RequestStatus } from "@/db/schema";

type ReqItem = { label: string; fulfilled: boolean; documentId?: string };
type ReqRow = {
  id: string;
  title: string;
  message: string | null;
  organizationId: string | null;
  contactId: string | null;
  items: ReqItem[] | null;
  status: RequestStatus;
  magicToken: string;
  expiresAt: Date | null;
  createdAt: Date;
  orgName: string | null;
};
type ContactLite = { id: string; firstName: string; lastName: string; organizationId: string | null };

const STATUS_META: Record<RequestStatus, { label: string; variant: "secondary" | "warning" | "success" | "destructive" }> = {
  open: { label: "Open", variant: "secondary" },
  partial: { label: "Partial", variant: "warning" },
  fulfilled: { label: "Fulfilled", variant: "success" },
  expired: { label: "Expired", variant: "destructive" },
};

function effectiveStatus(r: ReqRow): RequestStatus {
  if (r.expiresAt && r.expiresAt.getTime() < Date.now() && r.status !== "fulfilled") return "expired";
  return r.status;
}

export function DocumentRequests({
  requests,
  orgs,
  contacts,
  appUrl,
}: {
  requests: ReqRow[];
  orgs: OrgLite[];
  contacts: ContactLite[];
  appUrl: string;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);

  // Live refresh when a client uploads via the portal.
  useRealtimeEvent("file_event", (payload: unknown) => {
    if (payload && typeof payload === "object" && (payload as { type?: string }).type === "portal_upload") {
      router.refresh();
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/documents"
            className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Documents
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Document requests</h1>
          <p className="text-muted-foreground">
            Send clients a secure link to upload what you need.
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
              <Inbox className="h-7 w-7" />
            </div>
            <div>
              <p className="font-semibold">No document requests yet</p>
              <p className="text-sm text-muted-foreground">
                Create a request to get a shareable client upload link.
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

      <CreateRequestDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        orgs={orgs}
        contacts={contacts}
        appUrl={appUrl}
        onCreated={() => router.refresh()}
      />
    </div>
  );
}

function RequestCard({
  request: r,
  appUrl,
  onChanged,
}: {
  request: ReqRow;
  appUrl: string;
  onChanged: () => void;
}) {
  const items = r.items ?? [];
  const done = items.filter((i) => i.fulfilled).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const status = effectiveStatus(r);
  const meta = STATUS_META[status];
  const url = `${appUrl}/portal/${r.magicToken}`;

  async function onDelete() {
    const fd = new FormData();
    fd.set("id", r.id);
    const res = await deleteDocumentRequest(fd);
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

        {r.message && <p className="text-sm text-muted-foreground">{r.message}</p>}

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {done} of {items.length} received
            </span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>

        <ul className="space-y-1.5">
          {items.map((i, idx) => (
            <li key={idx} className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  i.fulfilled
                    ? "border-success bg-success text-success-foreground"
                    : "border-muted-foreground/40",
                )}
              >
                {i.fulfilled && <Check className="h-3 w-3" />}
              </span>
              <span className={cn(i.fulfilled ? "text-foreground" : "text-muted-foreground")}>
                {i.label}
              </span>
              {i.fulfilled && i.documentId && (
                <a
                  href={`/api/documents/${i.documentId}`}
                  className="ml-auto text-xs text-primary hover:underline"
                >
                  View
                </a>
              )}
            </li>
          ))}
        </ul>

        {r.expiresAt && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {r.expiresAt.getTime() < Date.now()
              ? "Expired"
              : `Expires ${formatDistanceToNow(r.expiresAt, { addSuffix: true })}`}
          </div>
        )}

        <div className="flex items-center gap-2 border-t pt-3">
          <CopyLinkButton url={url} />
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
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
      toast.success("Link copied");
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

function CreateRequestDialog({
  open,
  onOpenChange,
  orgs,
  contacts,
  appUrl,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgs: OrgLite[];
  contacts: ContactLite[];
  appUrl: string;
  onCreated: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [orgId, setOrgId] = React.useState<string>("");
  const [contactId, setContactId] = React.useState<string>("none");
  const [expiry, setExpiry] = React.useState<string>("14");
  const [items, setItems] = React.useState<string[]>([""]);

  React.useEffect(() => {
    if (open) {
      setOrgId("");
      setContactId("none");
      setExpiry("14");
      setItems([""]);
    }
  }, [open]);

  const orgContacts = contacts.filter((c) => c.organizationId === orgId);

  function setItem(i: number, v: string) {
    setItems((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  }
  function addItem() {
    setItems((prev) => [...prev, ""]);
  }
  function removeItem(i: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const labels = items.map((s) => s.trim()).filter(Boolean);
    if (!orgId) {
      toast.error("Pick a client.");
      return;
    }
    if (labels.length === 0) {
      toast.error("Add at least one requested item.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set("organizationId", orgId);
    fd.set("contactId", contactId === "none" ? "" : contactId);
    fd.set("expiresInDays", expiry === "never" ? "" : expiry);
    fd.set("items", JSON.stringify(labels));

    setPending(true);
    const res = await createDocumentRequest(fd);
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if ("data" in res && res.data) {
      try {
        await navigator.clipboard.writeText(`${appUrl}/portal/${res.data.token}`);
        toast.success("Request created — link copied to clipboard");
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
          <DialogTitle>New document request</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="req-title">Title *</Label>
            <Input id="req-title" name="title" required autoFocus placeholder="e.g. 2024 Tax Documents" />
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
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Contact</Label>
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

          <div className="space-y-1.5">
            <Label htmlFor="req-message">Message to client</Label>
            <Textarea
              id="req-message"
              name="message"
              rows={2}
              placeholder="Please upload the following so we can prepare your return…"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Requested items *</Label>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={it}
                    onChange={(e) => setItem(i, e.target.value)}
                    placeholder={`Item ${i + 1} — e.g. W-2`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => removeItem(i)}
                    disabled={items.length === 1}
                    aria-label="Remove item"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addItem} className="mt-1">
              <Plus className="h-3.5 w-3.5" /> Add item
            </Button>
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
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create & copy link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
