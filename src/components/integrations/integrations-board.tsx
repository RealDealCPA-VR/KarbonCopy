"use client";

import * as React from "react";
import {
  Plus,
  Loader2,
  Trash2,
  Pencil,
  RefreshCw,
  PlugZap,
  CheckCircle2,
  XCircle,
  CircleDashed,
  Database,
  Calculator,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
import type { PublicIntegrationConfig, IntegrationKind } from "@/lib/integrations/config-shared";
import { defaultConfigForKind } from "@/lib/integrations/config-shared";
import {
  createIntegration,
  updateIntegration,
  deleteIntegration,
  testConnection,
  syncClients,
  type IntegrationInput,
} from "@/app/(app)/integrations/actions";

type IntegrationItem = {
  id: string;
  kind: IntegrationKind;
  label: string;
  enabled: boolean;
  status: "ok" | "error" | "unconfigured";
  lastError: string | null;
  lastSyncAt: number | null;
  config: PublicIntegrationConfig;
};

const KIND_META: Record<
  IntegrationKind,
  { label: string; icon: typeof Database; blurb: string; syncLabel: string }
> = {
  quickbooks_desktop: {
    label: "QuickBooks Desktop",
    icon: Database,
    blurb: "Pull customers, invoices & books health from QuickBooks Desktop.",
    syncLabel: "Sync customers",
  },
  quickbooks_online: {
    label: "QuickBooks Online",
    icon: Database,
    blurb: "Connect a QuickBooks Online MCP bridge.",
    syncLabel: "Sync customers",
  },
  lacerte: {
    label: "Lacerte",
    icon: Calculator,
    blurb: "Read tax clients from Lacerte (TY18+) on this Windows machine.",
    syncLabel: "Sync clients",
  },
  drake: { label: "Drake", icon: Calculator, blurb: "Drake tax software bridge.", syncLabel: "Sync clients" },
  ultratax: { label: "UltraTax", icon: Calculator, blurb: "UltraTax bridge.", syncLabel: "Sync clients" },
};

const ADDABLE: IntegrationKind[] = ["quickbooks_desktop", "lacerte"];

type Draft = {
  id?: string;
  kind: IntegrationKind;
  label: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string;
  args: string; // space-friendly: one arg per line
  cwd: string;
  url: string;
  dataFolderPath: string;
  env: string; // KEY=value per line; blank = keep existing
  hasSecrets: boolean;
};

function emptyDraft(kind: IntegrationKind): Draft {
  const d = defaultConfigForKind(kind);
  return {
    kind,
    label: KIND_META[kind].label,
    enabled: true,
    transport: d.transport ?? "stdio",
    command: d.command ?? "",
    args: (d.args ?? []).join("\n"),
    cwd: d.cwd ?? "",
    url: d.url ?? "",
    dataFolderPath: "",
    env: "",
    hasSecrets: false,
  };
}

function fromItem(it: IntegrationItem): Draft {
  const c = it.config;
  return {
    id: it.id,
    kind: it.kind,
    label: it.label,
    enabled: it.enabled,
    transport: c.transport ?? "stdio",
    command: c.command ?? "",
    args: (c.args ?? []).join("\n"),
    cwd: c.cwd ?? "",
    url: c.url ?? "",
    dataFolderPath: c.dataFolderPath ?? "",
    env: "",
    hasSecrets: c.hasSecrets,
  };
}

function parseEnv(text: string): Record<string, string> | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined; // keep existing secrets
  const env: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

function StatusBadge({ status }: { status: IntegrationItem["status"] }) {
  if (status === "ok")
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> Connected
      </Badge>
    );
  if (status === "error")
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> Error
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1">
      <CircleDashed className="h-3 w-3" /> Not tested
    </Badge>
  );
}

export function IntegrationsBoard({ items: initial }: { items: IntegrationItem[] }) {
  const [items, setItems] = React.useState(initial);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(() => emptyDraft("quickbooks_desktop"));
  const [saving, setSaving] = React.useState(false);
  const [busy, setBusy] = React.useState<Record<string, "test" | "sync" | undefined>>({});

  const openCreate = (kind: IntegrationKind) => {
    setDraft(emptyDraft(kind));
    setOpen(true);
  };
  const openEdit = (it: IntegrationItem) => {
    setDraft(fromItem(it));
    setOpen(true);
  };

  const save = async () => {
    if (!draft.label.trim()) {
      toast.error("Label is required");
      return;
    }
    const input: IntegrationInput = {
      kind: draft.kind,
      label: draft.label.trim(),
      enabled: draft.enabled,
      transport: draft.transport,
      command: draft.command,
      args: draft.args.split(/\r?\n/).map((a) => a.trim()).filter(Boolean),
      cwd: draft.cwd,
      url: draft.url,
      dataFolderPath: draft.dataFolderPath,
      env: parseEnv(draft.env),
    };
    setSaving(true);
    const res = draft.id
      ? await updateIntegration(draft.id, input)
      : await createIntegration(input);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setOpen(false);
    toast.success(draft.id ? "Integration updated" : "Integration added");
    // Re-fetch via full reload for simplicity / source-of-truth correctness.
    window.location.reload();
  };

  const remove = async (it: IntegrationItem) => {
    if (!confirm(`Remove “${it.label}”? This won't touch the MCP server itself.`)) return;
    const prev = items;
    setItems((p) => p.filter((x) => x.id !== it.id));
    const res = await deleteIntegration(it.id);
    if (!res.ok) {
      setItems(prev);
      toast.error(res.error);
      return;
    }
    toast.success("Integration removed");
  };

  const runTest = async (it: IntegrationItem) => {
    setBusy((b) => ({ ...b, [it.id]: "test" }));
    const res = await testConnection(it.id);
    setBusy((b) => ({ ...b, [it.id]: undefined }));
    if (!res.ok) {
      setItems((p) =>
        p.map((x) => (x.id === it.id ? { ...x, status: "error", lastError: res.error } : x)),
      );
      toast.error(`Connection failed: ${res.error}`);
      return;
    }
    setItems((p) =>
      p.map((x) => (x.id === it.id ? { ...x, status: "ok", lastError: null } : x)),
    );
    toast.success(`Connected — ${res.data?.toolCount ?? 0} tools available`);
  };

  const runSync = async (it: IntegrationItem) => {
    setBusy((b) => ({ ...b, [it.id]: "sync" }));
    const res = await syncClients(it.id);
    setBusy((b) => ({ ...b, [it.id]: undefined }));
    if (!res.ok) {
      setItems((p) =>
        p.map((x) => (x.id === it.id ? { ...x, status: "error", lastError: res.error } : x)),
      );
      toast.error(`Sync failed: ${res.error}`);
      return;
    }
    const now = Date.now();
    setItems((p) =>
      p.map((x) => (x.id === it.id ? { ...x, status: "ok", lastError: null, lastSyncAt: now } : x)),
    );
    toast.success(
      `Synced ${res.data?.total ?? 0} — ${res.data?.created ?? 0} new, ${res.data?.matched ?? 0} linked`,
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Each integration launches a local MCP server as a child process and talks to it over
            stdio. Set the launch <strong>command</strong> + working folder; secrets are encrypted
            at rest. Use <strong>Test connection</strong> to verify, then <strong>Sync</strong> to
            import clients.
          </span>
        </div>
        <div className="flex gap-2">
          {ADDABLE.map((kind) => {
            const M = KIND_META[kind];
            return (
              <Button key={kind} size="sm" variant="outline" className="gap-1.5" onClick={() => openCreate(kind)}>
                <Plus className="h-4 w-4" /> {M.label}
              </Button>
            );
          })}
        </div>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <PlugZap className="h-6 w-6" />
            </div>
            <p className="font-medium">No integrations yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add your QuickBooks Desktop or Lacerte MCP server to import clients and surface books
              health — all over your local network.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((it) => {
            const M = KIND_META[it.kind];
            const Icon = M.icon;
            const b = busy[it.id];
            return (
              <Card key={it.id} className="overflow-hidden">
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div className="flex items-start gap-3">
                    <div
                      className={
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg " +
                        (it.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")
                      }
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2 text-base">
                        {it.label}
                      </CardTitle>
                      <CardDescription className="text-xs">{M.label}</CardDescription>
                    </div>
                  </div>
                  <StatusBadge status={it.status} />
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-lg border bg-muted/30 p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Transport</span>
                      <span className="font-medium uppercase">{it.config.transport}</span>
                    </div>
                    {it.config.transport === "stdio" ? (
                      <code className="mt-1 block truncate font-mono text-[11px] text-muted-foreground" title={`${it.config.command ?? ""} ${(it.config.args ?? []).join(" ")}`}>
                        {it.config.command || "(no command)"} {(it.config.args ?? []).join(" ")}
                      </code>
                    ) : (
                      <code className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                        {it.config.url || "(no url)"}
                      </code>
                    )}
                    {it.config.hasSecrets && (
                      <Badge variant="outline" className="mt-1.5 text-[10px]">
                        Secrets set
                      </Badge>
                    )}
                  </div>

                  {it.status === "error" && it.lastError && (
                    <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                      {it.lastError}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {it.lastSyncAt
                      ? `Last synced ${new Date(it.lastSyncAt).toLocaleString()}`
                      : "Never synced"}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={!!b}
                      onClick={() => runTest(it)}
                    >
                      {b === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                      Test connection
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={!!b}
                      onClick={() => runSync(it)}
                    >
                      {b === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {M.syncLabel}
                    </Button>
                    <div className="ml-auto flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(it)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(it)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {draft.id ? "Edit integration" : `Add ${KIND_META[draft.kind].label}`}
            </DialogTitle>
            <DialogDescription>{KIND_META[draft.kind].blurb}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="int-label">Label</Label>
              <Input
                id="int-label"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="QuickBooks — Main Company File"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(["stdio", "http"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDraft({ ...draft, transport: t })}
                  className={
                    "rounded-lg border px-3 py-2 text-sm transition-colors " +
                    (draft.transport === t
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted")
                  }
                >
                  {t === "stdio" ? "Local (stdio)" : "HTTP"}
                </button>
              ))}
            </div>

            {draft.transport === "stdio" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="int-command">Launch command</Label>
                  <Input
                    id="int-command"
                    className="font-mono"
                    value={draft.command}
                    onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                    placeholder="node  (or absolute path to a .exe)"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="int-args">Arguments (one per line)</Label>
                  <textarea
                    id="int-args"
                    className="flex min-h-[64px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={draft.args}
                    onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                    placeholder={"dist/index.js"}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="int-cwd">Working folder (MCP project root)</Label>
                  <Input
                    id="int-cwd"
                    className="font-mono"
                    value={draft.cwd}
                    onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
                    placeholder="C:\\Users\\...\\Quickbooks MCP Desktop"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="int-url">Endpoint URL (localhost)</Label>
                <Input
                  id="int-url"
                  className="font-mono"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder="http://127.0.0.1:8000/mcp"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="int-folder">Data / watched folder (optional)</Label>
              <Input
                id="int-folder"
                className="font-mono"
                value={draft.dataFolderPath}
                onChange={(e) => setDraft({ ...draft, dataFolderPath: e.target.value })}
                placeholder="C:\\Lacerte\\21data  or  company file folder"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="int-env">
                Secret env vars (KEY=value per line)
                {draft.hasSecrets && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    — secrets are set; leave blank to keep them
                  </span>
                )}
              </Label>
              <textarea
                id="int-env"
                className="flex min-h-[64px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={draft.env}
                onChange={(e) => setDraft({ ...draft, env: e.target.value })}
                placeholder={"QB_COMPANY_FILE=C:\\path\\file.qbw\nQB_LIVE=1"}
              />
              <p className="text-xs text-muted-foreground">
                Encrypted at rest. e.g. QB_COMPANY_FILE / QB_LIVE for QuickBooks, LACERTE_LIVE for
                Lacerte.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Enabled</Label>
                <p className="text-xs text-muted-foreground">Allow this integration to be used.</p>
              </div>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {draft.id ? "Save changes" : "Add integration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
