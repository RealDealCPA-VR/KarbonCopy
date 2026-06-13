"use client";

import * as React from "react";
import {
  FileCog,
  Plus,
  Trash2,
  Loader2,
  Pencil,
  Check,
  X,
  FlaskConical,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { FileRule, FileRuleEvent, WatchedRoot } from "@/db/schema";
import {
  createFileRule,
  deleteFileRule,
  updateFileRule,
} from "@/app/(app)/settings/actions";
import { globMatches } from "./glob";
import { reloadWatchers } from "./reload";

type Severity = "info" | "success" | "warning";
type NotifyMode = "all" | "owner";

type Draft = {
  id?: string;
  rootId: string;
  name: string;
  globPattern: string;
  event: FileRuleEvent;
  notify: NotifyMode | string[];
  message: string;
  severity: Severity;
  enabled: boolean;
};

const EVENTS: { value: FileRuleEvent; label: string }[] = [
  { value: "add", label: "File added" },
  { value: "change", label: "File changed" },
  { value: "unlink", label: "File removed" },
  { value: "addDir", label: "Folder created" },
];

const SEVERITIES: { value: Severity; label: string }[] = [
  { value: "success", label: "Success (green)" },
  { value: "info", label: "Info (blue)" },
  { value: "warning", label: "Warning (amber)" },
];

const GLOB_EXAMPLES = ["**/Completed/**", "**/*_FINAL.*", "**/Returns/**/*.pdf"];

function newDraft(rootId: string): Draft {
  return {
    rootId,
    name: "",
    globPattern: "",
    event: "add",
    notify: "all",
    message: "{file} ready in {folder} for {client}",
    severity: "success",
    enabled: true,
  };
}

function notifyLabel(notify: FileRule["notify"]): string {
  if (notify === "owner") return "Client owner";
  if (notify === "all" || notify == null) return "Everyone";
  if (Array.isArray(notify)) return `${notify.length} user${notify.length === 1 ? "" : "s"}`;
  return String(notify);
}

const sevBadge: Record<Severity, "success" | "secondary" | "warning"> = {
  success: "success",
  info: "secondary",
  warning: "warning",
};

export function FileRulesTab({
  roots,
  rules: initial,
  users,
}: {
  roots: WatchedRoot[];
  rules: FileRule[];
  users: { id: string; name: string }[];
}) {
  const [rules, setRules] = React.useState(initial);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(newDraft(roots[0]?.id ?? ""));
  const [saving, setSaving] = React.useState(false);
  const [sample, setSample] = React.useState("Acme LLC/Completed/Acme_1120S_FINAL.pdf");

  const matches = globMatches(draft.globPattern, sample);

  const openCreate = () => {
    if (roots.length === 0) {
      toast.error("Add a watched folder first");
      return;
    }
    setDraft(newDraft(roots[0].id));
    setOpen(true);
  };

  const openEdit = (r: FileRule) => {
    const notify: NotifyMode | string[] = Array.isArray(r.notify)
      ? r.notify
      : r.notify === "owner"
        ? "owner"
        : "all";
    setDraft({
      id: r.id,
      rootId: r.rootId,
      name: r.name,
      globPattern: r.globPattern,
      event: r.event,
      notify,
      message: r.message ?? "",
      severity: r.severity,
      enabled: r.enabled,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.globPattern.trim()) {
      toast.error("Name and pattern are required");
      return;
    }
    setSaving(true);
    const payload = {
      name: draft.name,
      globPattern: draft.globPattern,
      event: draft.event,
      notify: draft.notify,
      message: draft.message,
      severity: draft.severity,
      enabled: draft.enabled,
    };
    const res = draft.id
      ? await updateFileRule(draft.id, payload)
      : await createFileRule({ ...payload, rootId: draft.rootId });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (draft.id) {
      setRules((prev) =>
        prev.map((r) =>
          r.id === draft.id ? { ...r, ...payload, message: draft.message || null } : r,
        ),
      );
    } else {
      const id = "data" in res && res.data ? res.data.id : Math.random().toString();
      setRules((prev) => [
        ...prev,
        { ...payload, id, rootId: draft.rootId, message: draft.message || null, createdAt: new Date() } as FileRule,
      ]);
    }
    setOpen(false);
    toast.success(draft.id ? "Rule updated" : "Rule created");
    reloadWatchers({ silent: true });
  };

  const toggleEnabled = async (r: FileRule, enabled: boolean) => {
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled } : x)));
    const res = await updateFileRule(r.id, { enabled });
    if (!res.ok) {
      setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: !enabled } : x)));
      toast.error(res.error);
      return;
    }
    reloadWatchers({ silent: true });
  };

  const remove = async (r: FileRule) => {
    if (!confirm(`Delete rule “${r.name}”?`)) return;
    const prev = rules;
    setRules((p) => p.filter((x) => x.id !== r.id));
    const res = await deleteFileRule(r.id);
    if (!res.ok) {
      setRules(prev);
      toast.error(res.error);
      return;
    }
    toast.success("Rule deleted");
    reloadWatchers({ silent: true });
  };

  const rootLabel = (id: string) => roots.find((r) => r.id === id)?.label ?? "Unknown root";

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileCog className="h-4 w-4" /> File rules
          </CardTitle>
          <CardDescription>
            Glob patterns that turn file-server events into client alerts.
          </CardDescription>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add rule
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <FileCog className="h-6 w-6" />
            </div>
            <p className="font-medium">No rules yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create a rule like <code className="font-mono">**/Completed/**</code> to alert your team
              when a return is marked done.
            </p>
          </div>
        ) : (
          rules.map((r) => (
            <div
              key={r.id}
              className="flex items-start gap-4 rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <Badge variant={sevBadge[r.severity]} className="text-[10px] capitalize">
                    {r.severity}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    on {EVENTS.find((e) => e.value === r.event)?.label ?? r.event}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {rootLabel(r.rootId)}
                  </Badge>
                </div>
                <code className="mt-1 block truncate font-mono text-xs text-primary" title={r.globPattern}>
                  {r.globPattern}
                </code>
                <p className="mt-1 text-xs text-muted-foreground">
                  Notifies {notifyLabel(r.notify)}
                  {r.message ? ` · “${r.message}”` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch checked={r.enabled} onCheckedChange={(v) => toggleEnabled(r, v)} />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(r)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(r)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit file rule" : "New file rule"}</DialogTitle>
            <DialogDescription>
              Match a file pattern and alert the right people.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="fr-name">Name</Label>
              <Input
                id="fr-name"
                placeholder="Return marked complete"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            {!draft.id && (
              <div className="space-y-2">
                <Label>Watched folder</Label>
                <Select value={draft.rootId} onValueChange={(v) => setDraft({ ...draft, rootId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a root" />
                  </SelectTrigger>
                  <SelectContent>
                    {roots.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="fr-glob">Glob pattern</Label>
              <Input
                id="fr-glob"
                placeholder="**/Completed/**"
                className="font-mono"
                value={draft.globPattern}
                onChange={(e) => setDraft({ ...draft, globPattern: e.target.value })}
              />
              <div className="flex flex-wrap gap-1.5">
                {GLOB_EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className="rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => setDraft({ ...draft, globPattern: ex })}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            {/* glob tester */}
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <Label htmlFor="fr-sample" className="flex items-center gap-1.5 text-xs">
                <FlaskConical className="h-3.5 w-3.5" /> Glob tester
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="fr-sample"
                  className="h-8 font-mono text-xs"
                  placeholder="Acme LLC/Completed/return_FINAL.pdf"
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                />
                <span
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium",
                    !draft.globPattern
                      ? "bg-muted text-muted-foreground"
                      : matches
                        ? "bg-success/15 text-success"
                        : "bg-destructive/10 text-destructive",
                  )}
                >
                  {!draft.globPattern ? (
                    "—"
                  ) : matches ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Match
                    </>
                  ) : (
                    <>
                      <X className="h-3.5 w-3.5" /> No match
                    </>
                  )}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Tested against the path relative to the watched root.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Trigger event</Label>
                <Select
                  value={draft.event}
                  onValueChange={(v) => setDraft({ ...draft, event: v as FileRuleEvent })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENTS.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select
                  value={draft.severity}
                  onValueChange={(v) => setDraft({ ...draft, severity: v as Severity })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notify</Label>
              <Select
                value={Array.isArray(draft.notify) ? "custom" : draft.notify}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    notify: v === "custom" ? (Array.isArray(draft.notify) ? draft.notify : []) : (v as NotifyMode),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="owner">Client owner</SelectItem>
                  <SelectItem value="custom">Specific users…</SelectItem>
                </SelectContent>
              </Select>
              {Array.isArray(draft.notify) && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {users.map((u) => {
                    const selected = (draft.notify as string[]).includes(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs transition-colors",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-accent",
                        )}
                        onClick={() => {
                          const arr = draft.notify as string[];
                          setDraft({
                            ...draft,
                            notify: selected ? arr.filter((x) => x !== u.id) : [...arr, u.id],
                          });
                        }}
                      >
                        {u.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="fr-msg">Message template</Label>
              <Textarea
                id="fr-msg"
                rows={2}
                value={draft.message}
                onChange={(e) => setDraft({ ...draft, message: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                Placeholders: <code className="font-mono">{"{file}"}</code>{" "}
                <code className="font-mono">{"{client}"}</code>{" "}
                <code className="font-mono">{"{folder}"}</code>
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label>Enabled</Label>
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
              {draft.id ? "Save changes" : "Create rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
