"use client";

import * as React from "react";
import {
  KeyRound,
  Plus,
  Trash2,
  Loader2,
  Copy,
  Check,
  ShieldCheck,
  TriangleAlert,
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createKey, revokeKey } from "@/app/(app)/settings/api-keys/actions";

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  userId: string;
  userName: string;
  revoked: boolean;
  lastUsedAt: number | null;
  expiresAt: number | null;
  createdAt: number | null;
};

type UserOption = { id: string; name: string; role: string };

function relativeTime(ms: number | null): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ApiKeysManager({
  initialKeys,
  users,
  defaultUserId,
}: {
  initialKeys: ApiKeyRow[];
  users: UserOption[];
  defaultUserId: string;
}) {
  const [keys, setKeys] = React.useState<ApiKeyRow[]>(initialKeys);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [userId, setUserId] = React.useState(defaultUserId);
  const [saving, setSaving] = React.useState(false);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);

  // The freshly-minted raw key, shown once in its own dialog.
  const [revealed, setRevealed] = React.useState<{ raw: string; name: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  const openCreate = () => {
    setName("");
    setUserId(defaultUserId);
    setCreateOpen(true);
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Give the key a name");
      return;
    }
    if (!userId) {
      toast.error("Choose a user the key acts as");
      return;
    }
    setSaving(true);
    const res = await createKey({ name: name.trim(), userId });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const created = res.data!;
    const actsAs = users.find((u) => u.id === userId)?.name ?? "Unknown user";
    setKeys((prev) => [
      {
        id: created.id,
        name: name.trim(),
        prefix: created.prefix,
        userId,
        userName: actsAs,
        revoked: false,
        lastUsedAt: null,
        expiresAt: null,
        createdAt: Date.now(),
      },
      ...prev,
    ]);
    setCreateOpen(false);
    setCopied(false);
    setRevealed({ raw: created.raw, name: name.trim() });
  };

  const revoke = async (key: ApiKeyRow) => {
    if (
      !confirm(
        `Revoke “${key.name}”? Any script or MCP client using it will immediately lose access. This cannot be undone.`,
      )
    )
      return;
    setRevokingId(key.id);
    const res = await revokeKey(key.id);
    setRevokingId(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setKeys((prev) => prev.map((k) => (k.id === key.id ? { ...k, revoked: true } : k)));
    toast.success("Key revoked");
  };

  const copyRaw = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.raw);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the key and copy manually");
    }
  };

  const activeCount = keys.filter((k) => !k.revoked).length;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> API keys
          </CardTitle>
          <CardDescription>
            {activeCount === 0
              ? "No active keys."
              : `${activeCount} active key${activeCount === 1 ? "" : "s"}.`}{" "}
            Each key acts as the chosen user.
          </CardDescription>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Create key
        </Button>
      </CardHeader>
      <CardContent>
        {keys.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <KeyRound className="h-6 w-6" />
            </div>
            <p className="font-medium">No API keys yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create a key to let Claude (via the MCP server) or your own scripts read and write
              data through the API.
            </p>
            <Button size="sm" className="mt-2 gap-1.5" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Create your first key
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Acts as</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id} className={k.revoked ? "opacity-55" : undefined}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{k.name}</span>
                        {k.revoked && (
                          <Badge variant="secondary" className="shrink-0 text-[10px] uppercase">
                            Revoked
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {k.prefix}…
                      </code>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-sm">
                        <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        {k.userName}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {relativeTime(k.lastUsedAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(k.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {k.revoked ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5 text-muted-foreground hover:text-destructive"
                          disabled={revokingId === k.id}
                          onClick={() => revoke(k)}
                        >
                          {revokingId === k.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The key will act as the selected user and inherit their role. You&apos;ll see the
              raw key once after it&apos;s created.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="ak-name">Name</Label>
              <Input
                id="ak-name"
                placeholder="Claude Desktop"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !saving) submit();
                }}
              />
              <p className="text-xs text-muted-foreground">
                A label to recognise this key later, e.g. the tool or person using it.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ak-user">Acts as</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="ak-user">
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      <span className="flex items-center gap-2">
                        {u.name}
                        <span className="text-xs uppercase text-muted-foreground">{u.role}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Requests made with this key are attributed to, and limited by the role of, this
                user.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reveal dialog — shows the raw key exactly once */}
      <Dialog
        open={!!revealed}
        onOpenChange={(o) => {
          if (!o) setRevealed(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-success" />
              API key created
            </DialogTitle>
            <DialogDescription>
              {revealed ? <>Key “{revealed.name}” is ready.</> : null} Copy it now — for your
              security it won&apos;t be shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span className="text-foreground">
                This is the only time you&apos;ll see the full key. Store it somewhere safe (a
                password manager, or your MCP client config). If you lose it, revoke it and create
                a new one.
              </span>
            </div>

            <div className="space-y-2">
              <Label>Your new key</Label>
              <div className="flex items-stretch gap-2">
                <code className="flex-1 break-all rounded-lg border bg-muted/60 p-3 font-mono text-sm text-foreground">
                  {revealed?.raw}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 gap-1.5 self-stretch"
                  onClick={copyRaw}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setRevealed(null)}>I&apos;ve saved my key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
