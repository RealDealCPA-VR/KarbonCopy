"use client";

import * as React from "react";
import {
  Mail,
  Plus,
  Trash2,
  Loader2,
  Pencil,
  Server,
  Inbox,
  Send,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plug,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SafeEmailAccount } from "@/lib/email/config";

type Draft = {
  id?: string;
  label: string;
  address: string;
  enabled: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  imapUser: string;
  imapPass: string;
  imapMailbox: string;
  // whether existing creds are already stored (so blank password = keep)
  smtpHasPass: boolean;
  imapHasPass: boolean;
};

const emptyDraft: Draft = {
  label: "",
  address: "",
  enabled: true,
  smtpHost: "",
  smtpPort: "587",
  smtpSecure: false,
  smtpUser: "",
  smtpPass: "",
  imapHost: "",
  imapPort: "993",
  imapSecure: true,
  imapUser: "",
  imapPass: "",
  imapMailbox: "INBOX",
  smtpHasPass: false,
  imapHasPass: false,
};

function draftFromAccount(a: SafeEmailAccount): Draft {
  return {
    id: a.id,
    label: a.label,
    address: a.address,
    enabled: a.enabled,
    smtpHost: a.smtp?.host ?? "",
    smtpPort: String(a.smtp?.port ?? 587),
    smtpSecure: a.smtp?.secure ?? false,
    smtpUser: a.smtp?.user ?? "",
    smtpPass: "",
    imapHost: a.imap?.host ?? "",
    imapPort: String(a.imap?.port ?? 993),
    imapSecure: a.imap?.secure ?? true,
    imapUser: a.imap?.user ?? "",
    imapPass: "",
    imapMailbox: a.imap?.mailbox ?? "INBOX",
    smtpHasPass: a.smtp?.hasPass ?? false,
    imapHasPass: a.imap?.hasPass ?? false,
  };
}

function draftToPayload(d: Draft) {
  return {
    label: d.label.trim(),
    address: d.address.trim(),
    enabled: d.enabled,
    smtp: {
      host: d.smtpHost.trim(),
      port: Number(d.smtpPort) || 587,
      secure: d.smtpSecure,
      user: d.smtpUser.trim(),
      pass: d.smtpPass,
    },
    imap: {
      host: d.imapHost.trim(),
      port: Number(d.imapPort) || 993,
      secure: d.imapSecure,
      user: d.imapUser.trim(),
      pass: d.imapPass,
      mailbox: d.imapMailbox.trim() || "INBOX",
    },
  };
}

function relativeTime(ms: number | null): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

type TestResult = { smtp: { ok: boolean; error?: string }; imap: { ok: boolean; error?: string } };

export function EmailAccountsManager({
  initialAccounts,
}: {
  initialAccounts: SafeEmailAccount[];
}) {
  const [accounts, setAccounts] = React.useState(initialAccounts);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);

  const openCreate = () => {
    setDraft(emptyDraft);
    setTestResult(null);
    setOpen(true);
  };
  const openEdit = (a: SafeEmailAccount) => {
    setDraft(draftFromAccount(a));
    setTestResult(null);
    setOpen(true);
  };

  const save = async () => {
    if (!draft.label.trim() || !draft.address.trim()) {
      toast.error("Label and email address are required");
      return;
    }
    setSaving(true);
    const payload = draftToPayload(draft);
    const res = await fetch(
      draft.id ? `/api/email/accounts/${draft.id}` : "/api/email/accounts",
      {
        method: draft.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "Failed to save account");
      return;
    }
    const saved = data.account as SafeEmailAccount;
    setAccounts((prev) =>
      draft.id ? prev.map((a) => (a.id === saved.id ? saved : a)) : [...prev, saved],
    );
    setOpen(false);
    toast.success(draft.id ? "Account updated" : "Account added");
  };

  const toggleEnabled = async (a: SafeEmailAccount, enabled: boolean) => {
    setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, enabled } : x)));
    const res = await fetch(`/api/email/accounts/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, enabled: !enabled } : x)));
      toast.error("Failed to update");
    }
  };

  const remove = async (a: SafeEmailAccount) => {
    if (!confirm(`Remove “${a.label}”? Incoming mail will stop syncing.`)) return;
    const prev = accounts;
    setAccounts((p) => p.filter((x) => x.id !== a.id));
    const res = await fetch(`/api/email/accounts/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      setAccounts(prev);
      toast.error("Failed to remove account");
      return;
    }
    toast.success("Account removed");
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    const payload = draftToPayload(draft);
    const res = await fetch("/api/email/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: draft.id, ...payload }),
    });
    setTesting(false);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      toast.error((data && data.error) || "Connection test failed");
      return;
    }
    setTestResult(data as TestResult);
    if (data.smtp.ok && data.imap.ok) toast.success("Both SMTP and IMAP connected");
    else toast.error("One or more checks failed — see details");
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Connected mailboxes
          </CardTitle>
          <CardDescription>
            SMTP/IMAP accounts the firm uses to send and receive client mail.
          </CardDescription>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add account
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Inbox className="h-6 w-6" />
            </div>
            <p className="font-medium">No mailboxes connected</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add your firm&apos;s SMTP/IMAP mailbox to start sending and receiving real email
              from the Triage inbox.
            </p>
          </div>
        ) : (
          accounts.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm"
            >
              <div
                className={
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg " +
                  (a.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")
                }
              >
                <Mail className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{a.label}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
                    {a.provider === "smtp_imap" ? "SMTP/IMAP" : a.provider}
                  </Badge>
                  {!a.configured && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      Not configured
                    </Badge>
                  )}
                </div>
                <code className="block truncate font-mono text-xs text-muted-foreground" title={a.address}>
                  {a.address}
                </code>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>Last sync: {relativeTime(a.lastSyncAt)}</span>
                  {a.lastError && (
                    <span className="flex items-center gap-1 text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      <span className="max-w-[28ch] truncate" title={a.lastError}>
                        {a.lastError}
                      </span>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={a.enabled}
                  onCheckedChange={(v) => toggleEnabled(a, v)}
                  aria-label="Enabled"
                />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(a)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(a)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit email account" : "Add email account"}</DialogTitle>
            <DialogDescription>
              Enter your mailbox&apos;s SMTP (sending) and IMAP (receiving) settings. Passwords
              are encrypted before they touch the database.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ea-label">Label</Label>
                <Input
                  id="ea-label"
                  placeholder="Firm Inbox"
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ea-address">Email address</Label>
                <Input
                  id="ea-address"
                  type="email"
                  placeholder="hello@firm.com"
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                />
              </div>
            </div>

            {/* SMTP */}
            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Send className="h-4 w-4 text-primary" /> SMTP — outgoing
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                <div className="space-y-2">
                  <Label htmlFor="ea-smtp-host">Host</Label>
                  <Input
                    id="ea-smtp-host"
                    placeholder="smtp.firm.com"
                    className="font-mono"
                    value={draft.smtpHost}
                    onChange={(e) => setDraft({ ...draft, smtpHost: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ea-smtp-port">Port</Label>
                  <Input
                    id="ea-smtp-port"
                    inputMode="numeric"
                    value={draft.smtpPort}
                    onChange={(e) => setDraft({ ...draft, smtpPort: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ea-smtp-user">Username</Label>
                  <Input
                    id="ea-smtp-user"
                    value={draft.smtpUser}
                    onChange={(e) => setDraft({ ...draft, smtpUser: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ea-smtp-pass">Password</Label>
                  <Input
                    id="ea-smtp-pass"
                    type="password"
                    placeholder={draft.smtpHasPass ? "•••••••• (unchanged)" : ""}
                    value={draft.smtpPass}
                    onChange={(e) => setDraft({ ...draft, smtpPass: e.target.value })}
                  />
                </div>
              </div>
              <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <span>
                  Implicit TLS (port 465)
                  <span className="block text-xs text-muted-foreground">
                    Off uses STARTTLS (typically port 587).
                  </span>
                </span>
                <Switch
                  checked={draft.smtpSecure}
                  onCheckedChange={(v) => setDraft({ ...draft, smtpSecure: v })}
                />
              </label>
            </div>

            {/* IMAP */}
            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Server className="h-4 w-4 text-primary" /> IMAP — incoming
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                <div className="space-y-2">
                  <Label htmlFor="ea-imap-host">Host</Label>
                  <Input
                    id="ea-imap-host"
                    placeholder="imap.firm.com"
                    className="font-mono"
                    value={draft.imapHost}
                    onChange={(e) => setDraft({ ...draft, imapHost: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ea-imap-port">Port</Label>
                  <Input
                    id="ea-imap-port"
                    inputMode="numeric"
                    value={draft.imapPort}
                    onChange={(e) => setDraft({ ...draft, imapPort: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ea-imap-user">Username</Label>
                  <Input
                    id="ea-imap-user"
                    value={draft.imapUser}
                    onChange={(e) => setDraft({ ...draft, imapUser: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ea-imap-pass">Password</Label>
                  <Input
                    id="ea-imap-pass"
                    type="password"
                    placeholder={draft.imapHasPass ? "•••••••• (unchanged)" : ""}
                    value={draft.imapPass}
                    onChange={(e) => setDraft({ ...draft, imapPass: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ea-imap-mailbox">Mailbox</Label>
                  <Input
                    id="ea-imap-mailbox"
                    placeholder="INBOX"
                    value={draft.imapMailbox}
                    onChange={(e) => setDraft({ ...draft, imapMailbox: e.target.value })}
                  />
                </div>
                <label className="flex items-center justify-between self-end rounded-lg border p-3 text-sm">
                  <span>Implicit TLS (port 993)</span>
                  <Switch
                    checked={draft.imapSecure}
                    onCheckedChange={(v) => setDraft({ ...draft, imapSecure: v })}
                  />
                </label>
              </div>
            </div>

            {/* Test result */}
            {testResult && (
              <div className="space-y-2 rounded-xl border p-4 text-sm">
                <TestLine label="SMTP (send)" ok={testResult.smtp.ok} error={testResult.smtp.error} />
                <TestLine label="IMAP (receive)" ok={testResult.imap.ok} error={testResult.imap.error} />
              </div>
            )}
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={test} disabled={testing || saving} className="gap-1.5">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              Test connection
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving} className="gap-1.5">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {draft.id ? "Save changes" : "Add account"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TestLine({ label, ok, error }: { label: string; ok: boolean; error?: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0">
        <span className="font-medium">{label}</span>{" "}
        <span className={ok ? "text-success" : "text-destructive"}>
          {ok ? "connected" : "failed"}
        </span>
        {!ok && error && (
          <p className="break-words text-xs text-muted-foreground">{error}</p>
        )}
      </div>
    </div>
  );
}
