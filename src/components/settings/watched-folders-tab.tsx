"use client";

import * as React from "react";
import {
  FolderCog,
  Plus,
  Trash2,
  Network,
  Loader2,
  Info,
  Pencil,
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
import type { WatchedRoot } from "@/db/schema";
import {
  createWatchedRoot,
  deleteWatchedRoot,
  updateWatchedRoot,
} from "@/app/(app)/settings/actions";
import { reloadWatchers } from "./reload";

type Draft = {
  id?: string;
  label: string;
  path: string;
  enabled: boolean;
  matchOrgByFolder: boolean;
};

const emptyDraft: Draft = { label: "", path: "", enabled: true, matchOrgByFolder: true };

export function WatchedFoldersTab({
  roots: initial,
  ruleCounts,
}: {
  roots: WatchedRoot[];
  ruleCounts: Record<string, number>;
}) {
  const [roots, setRoots] = React.useState(initial);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [saving, setSaving] = React.useState(false);

  const openCreate = () => {
    setDraft(emptyDraft);
    setOpen(true);
  };
  const openEdit = (r: WatchedRoot) => {
    setDraft({
      id: r.id,
      label: r.label,
      path: r.path,
      enabled: r.enabled,
      matchOrgByFolder: r.matchOrgByFolder,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft.label.trim() || !draft.path.trim()) {
      toast.error("Label and path are required");
      return;
    }
    setSaving(true);
    const res = draft.id
      ? await updateWatchedRoot(draft.id, draft)
      : await createWatchedRoot(draft);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (draft.id) {
      setRoots((prev) => prev.map((r) => (r.id === draft.id ? { ...r, ...draft } : r)));
    } else {
      const id = "data" in res && res.data ? res.data.id : Math.random().toString();
      setRoots((prev) => [
        ...prev,
        { ...(draft as WatchedRoot), id, createdAt: new Date() },
      ]);
    }
    setOpen(false);
    toast.success(draft.id ? "Folder updated" : "Folder added");
    reloadWatchers();
  };

  const toggleEnabled = async (r: WatchedRoot, enabled: boolean) => {
    setRoots((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled } : x)));
    const res = await updateWatchedRoot(r.id, { enabled });
    if (!res.ok) {
      setRoots((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: !enabled } : x)));
      toast.error(res.error);
      return;
    }
    reloadWatchers({ silent: true });
  };

  const remove = async (r: WatchedRoot) => {
    if (!confirm(`Remove “${r.label}”? Its rules will be deleted too.`)) return;
    const prev = roots;
    setRoots((p) => p.filter((x) => x.id !== r.id));
    const res = await deleteWatchedRoot(r.id);
    if (!res.ok) {
      setRoots(prev);
      toast.error(res.error);
      return;
    }
    toast.success("Folder removed");
    reloadWatchers({ silent: true });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FolderCog className="h-4 w-4" /> Watched folders
          </CardTitle>
          <CardDescription>
            Network roots the file-server engine watches for completed files.
          </CardDescription>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add folder
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            UNC paths are supported, e.g.{" "}
            <code className="rounded bg-background px-1 py-0.5 font-mono">\\FILESERVER\Clients</code>.
            Enable <strong>Match client by folder</strong> to auto-link events to a client by the
            top-level folder name.
          </span>
        </div>

        {roots.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Network className="h-6 w-6" />
            </div>
            <p className="font-medium">No watched folders yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add your client file share to start catching completed returns automatically.
            </p>
          </div>
        ) : (
          roots.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm"
            >
              <div
                className={
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg " +
                  (r.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")
                }
              >
                <Network className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.label}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {ruleCounts[r.id] ?? 0} rule{(ruleCounts[r.id] ?? 0) === 1 ? "" : "s"}
                  </Badge>
                  {r.matchOrgByFolder && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      Auto-link
                    </Badge>
                  )}
                </div>
                <code className="block truncate font-mono text-xs text-muted-foreground" title={r.path}>
                  {r.path}
                </code>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={r.enabled}
                  onCheckedChange={(v) => toggleEnabled(r, v)}
                  aria-label="Enabled"
                />
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit watched folder" : "Add watched folder"}</DialogTitle>
            <DialogDescription>
              Point the engine at a folder or network share to monitor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="wf-label">Label</Label>
              <Input
                id="wf-label"
                placeholder="Client Returns Share"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wf-path">Path</Label>
              <Input
                id="wf-path"
                placeholder="\\FILESERVER\Clients"
                className="font-mono"
                value={draft.path}
                onChange={(e) => setDraft({ ...draft, path: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                A local path or a UNC share like <code>\\FILESERVER\Clients</code>.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Enabled</Label>
                <p className="text-xs text-muted-foreground">Actively watch this folder.</p>
              </div>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Match client by folder</Label>
                <p className="text-xs text-muted-foreground">
                  Auto-link events to a client via the top folder name.
                </p>
              </div>
              <Switch
                checked={draft.matchOrgByFolder}
                onCheckedChange={(v) => setDraft({ ...draft, matchOrgByFolder: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {draft.id ? "Save changes" : "Add folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
