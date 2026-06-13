"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileText, Folder, FolderOpen, FolderPlus, Upload, ChevronRight, Trash2,
  Download, Building2, Inbox, FilePlus2, MoreVertical, Globe, HardDrive, Files,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { createFolder, deleteDocument, deleteFolder } from "@/app/(app)/documents/actions";
import { formatBytes, type DocRow, type FolderLite, type OrgLite } from "./types";

const SOURCE_META: Record<DocRow["source"], { label: string; variant: "secondary" | "success" | "warning"; icon: typeof Upload }> = {
  upload: { label: "Upload", variant: "secondary", icon: Upload },
  portal: { label: "Portal", variant: "success", icon: Globe },
  fileserver: { label: "File server", variant: "warning", icon: HardDrive },
};

export function DocumentsBrowser({
  orgs,
  folders,
  documents,
  initialClient,
  initialFolder,
}: {
  orgs: OrgLite[];
  folders: FolderLite[];
  documents: DocRow[];
  initialClient: string | null;
  initialFolder: string | null;
}) {
  const router = useRouter();
  const [clientId, setClientId] = React.useState<string>(initialClient ?? "all");
  const [folderId, setFolderId] = React.useState<string | null>(initialFolder);
  const [query, setQuery] = React.useState("");
  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  // When client changes, drop the folder selection (folders are client-scoped).
  React.useEffect(() => {
    setFolderId(null);
  }, [clientId]);

  const scopedFolders = React.useMemo(
    () => (clientId === "all" ? [] : folders.filter((f) => f.organizationId === clientId)),
    [folders, clientId],
  );

  const breadcrumb = React.useMemo(() => {
    const chain: FolderLite[] = [];
    let cur = folderId ? scopedFolders.find((f) => f.id === folderId) ?? null : null;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? scopedFolders.find((f) => f.id === cur!.parentId) ?? null : null;
    }
    return chain;
  }, [folderId, scopedFolders]);

  const visibleDocs = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (clientId !== "all" && d.organizationId !== clientId) return false;
      if (clientId !== "all") {
        // when a client is selected, respect folder scoping
        if ((d.folderId ?? null) !== (folderId ?? null)) return false;
      }
      if (q && !d.name.toLowerCase().includes(q) && !(d.orgName ?? "").toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [documents, clientId, folderId, query]);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (clientId === "all") {
      toast.error("Pick a client before uploading.");
      return;
    }
    setUploading(true);
    let okCount = 0;
    for (const file of list) {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("organizationId", clientId);
      if (folderId) fd.set("folderId", folderId);
      try {
        const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
        if (res.ok) okCount++;
        else {
          const j = await res.json().catch(() => ({}));
          toast.error(j.error ?? `Failed to upload ${file.name}`);
        }
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
    if (okCount > 0) {
      toast.success(`Uploaded ${okCount} file${okCount === 1 ? "" : "s"}`);
      router.refresh();
    }
  }

  async function onDeleteDoc(d: DocRow) {
    const fd = new FormData();
    fd.set("id", d.id);
    const res = await deleteDocument(fd);
    if (res.ok) {
      toast.success("Document deleted");
      router.refresh();
    } else toast.error(res.error);
  }

  async function onDeleteFolder(f: FolderLite) {
    const fd = new FormData();
    fd.set("id", f.id);
    const res = await deleteFolder(fd);
    if (res.ok) {
      toast.success("Folder deleted");
      if (folderId === f.id) setFolderId(f.parentId);
      router.refresh();
    } else toast.error(res.error);
  }

  const canUpload = clientId !== "all";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">
            {documents.length} {documents.length === 1 ? "file" : "files"} across your firm
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/documents/requests">
              <Inbox className="h-4 w-4" /> Document requests
            </Link>
          </Button>
          <Button
            variant="outline"
            disabled={clientId === "all"}
            onClick={() => setNewFolderOpen(true)}
          >
            <FolderPlus className="h-4 w-4" /> New folder
          </Button>
          <Button disabled={!canUpload || uploading} onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {orgs.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-[220px] flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Folder tree */}
        <Card className="h-max">
          <CardContent className="p-3">
            {clientId === "all" ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                Select a client to browse folders.
              </div>
            ) : (
              <FolderTree
                folders={scopedFolders}
                selectedId={folderId}
                onSelect={setFolderId}
                onDelete={onDeleteFolder}
              />
            )}
          </CardContent>
        </Card>

        {/* Main panel */}
        <div className="space-y-4">
          {clientId !== "all" && (
            <nav className="flex flex-wrap items-center gap-1 text-sm">
              <button
                onClick={() => setFolderId(null)}
                className={cn(
                  "rounded-md px-2 py-1 transition-colors hover:bg-accent",
                  !folderId && "font-medium text-foreground",
                  folderId && "text-muted-foreground",
                )}
              >
                {orgs.find((o) => o.id === clientId)?.name ?? "Client"}
              </button>
              {breadcrumb.map((f) => (
                <React.Fragment key={f.id}>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <button
                    onClick={() => setFolderId(f.id)}
                    className={cn(
                      "rounded-md px-2 py-1 transition-colors hover:bg-accent",
                      folderId === f.id ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {f.name}
                  </button>
                </React.Fragment>
              ))}
            </nav>
          )}

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              if (!canUpload) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (canUpload && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
            }}
            className={cn(
              "rounded-xl border-2 border-dashed p-6 text-center transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-border",
              !canUpload && "opacity-60",
            )}
          >
            <Upload className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {canUpload ? (
                <>
                  Drag &amp; drop files here, or{" "}
                  <button
                    className="font-medium text-primary hover:underline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    browse
                  </button>
                  {folderId ? " — uploads land in this folder." : "."}
                </>
              ) : (
                "Select a client to upload documents."
              )}
            </p>
          </div>

          {visibleDocs.length === 0 ? (
            <EmptyDocs hasAny={documents.length > 0} />
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Name</th>
                      {clientId === "all" && <th className="px-4 py-3 font-medium">Client</th>}
                      <th className="px-4 py-3 font-medium">Source</th>
                      <th className="px-4 py-3 text-right font-medium">Size</th>
                      <th className="px-4 py-3 text-right font-medium">Ver.</th>
                      <th className="px-4 py-3 font-medium">Uploaded by</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDocs.map((d) => {
                      const meta = SOURCE_META[d.source];
                      const Icon = meta.icon;
                      return (
                        <tr key={d.id} className="border-b last:border-0 transition-colors hover:bg-accent/50">
                          <td className="px-4 py-3">
                            <a
                              href={`/api/documents/${d.id}`}
                              className="flex items-center gap-2 font-medium hover:text-primary"
                            >
                              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="truncate">{d.name}</span>
                            </a>
                            {d.workTitle && (
                              <span className="ml-6 text-xs text-muted-foreground">{d.workTitle}</span>
                            )}
                          </td>
                          {clientId === "all" && (
                            <td className="px-4 py-3 text-muted-foreground">
                              {d.organizationId ? (
                                <Link
                                  href={`/clients/${d.organizationId}`}
                                  className="hover:text-primary"
                                >
                                  {d.orgName ?? "—"}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <Badge variant={meta.variant} className="gap-1">
                              <Icon className="h-3 w-3" /> {meta.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                            {formatBytes(d.sizeBytes)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                            v{d.version}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {d.uploaderName ?? (d.source === "portal" ? "Client" : "—")}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}
                          </td>
                          <td className="px-2 py-3 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <a href={`/api/documents/${d.id}`}>
                                    <Download className="h-4 w-4" /> Download
                                  </a>
                                </DropdownMenuItem>
                                {d.workItemId && (
                                  <DropdownMenuItem asChild>
                                    <Link href={`/work/${d.workItemId}`}>
                                      <Files className="h-4 w-4" /> Open work item
                                    </Link>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => onDeleteDoc(d)}
                                >
                                  <Trash2 className="h-4 w-4" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>

      <NewFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        organizationId={clientId === "all" ? null : clientId}
        parentId={folderId}
        parentName={breadcrumb.at(-1)?.name ?? orgs.find((o) => o.id === clientId)?.name ?? null}
        onCreated={() => router.refresh()}
      />
    </div>
  );
}

function FolderTree({
  folders,
  selectedId,
  onSelect,
  onDelete,
}: {
  folders: FolderLite[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (f: FolderLite) => void;
}) {
  const childrenOf = (parentId: string | null) =>
    folders.filter((f) => (f.parentId ?? null) === parentId);

  const render = (parentId: string | null, depth: number): React.ReactNode => {
    const kids = childrenOf(parentId);
    if (kids.length === 0) return null;
    return kids.map((f) => {
      const active = selectedId === f.id;
      return (
        <div key={f.id}>
          <div
            className={cn(
              "group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent",
              active && "bg-accent font-medium",
            )}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <button
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              onClick={() => onSelect(f.id)}
            >
              {active ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{f.name}</span>
            </button>
            <button
              className="opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Delete folder"
              onClick={() => onDelete(f)}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
          {render(f.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="space-y-0.5">
      <button
        className={cn(
          "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent",
          !selectedId && "bg-accent font-medium",
        )}
        onClick={() => onSelect(null)}
      >
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" /> All files
      </button>
      {render(null, 0)}
      {folders.length === 0 && (
        <p className="px-2 py-3 text-xs text-muted-foreground">No folders yet.</p>
      )}
    </div>
  );
}

function NewFolderDialog({
  open,
  onOpenChange,
  organizationId,
  parentId,
  parentName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizationId: string | null;
  parentId: string | null;
  parentName: string | null;
  onCreated: () => void;
}) {
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!organizationId) return;
    const fd = new FormData(e.currentTarget);
    fd.set("organizationId", organizationId);
    if (parentId) fd.set("parentId", parentId);
    setPending(true);
    const res = await createFolder(fd);
    setPending(false);
    if (res.ok) {
      toast.success("Folder created");
      onOpenChange(false);
      onCreated();
    } else toast.error(res.error);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="folder-name">Name</Label>
            <Input id="folder-name" name="name" required autoFocus placeholder="e.g. 2024 Tax Year" />
            {parentName && (
              <p className="text-xs text-muted-foreground">Inside {parentName}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmptyDocs({ hasAny }: { hasAny: boolean }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <FilePlus2 className="h-7 w-7" />
        </div>
        <div>
          <p className="font-semibold">{hasAny ? "No documents here" : "No documents yet"}</p>
          <p className="text-sm text-muted-foreground">
            Upload files or request them from a client to get started.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
