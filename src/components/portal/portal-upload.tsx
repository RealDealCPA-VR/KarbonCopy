"use client";

import * as React from "react";
import {
  ShieldCheck, UploadCloud, Check, Loader2, FileText, CheckCircle2, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Item = { label: string; fulfilled: boolean };
type ItemState = "idle" | "uploading" | "done" | "error";

export function PortalUpload({
  token,
  title,
  message,
  firmName,
  items: initialItems,
}: {
  token: string;
  title: string;
  message: string | null;
  firmName: string | null;
  items: Item[];
}) {
  const [items, setItems] = React.useState<Item[]>(initialItems);
  const [states, setStates] = React.useState<ItemState[]>(() =>
    initialItems.map((i) => (i.fulfilled ? "done" : "idle")),
  );
  const [errors, setErrors] = React.useState<(string | null)[]>(() => initialItems.map(() => null));

  const total = items.length;
  const done = items.filter((i) => i.fulfilled).length;
  const allDone = total > 0 && done === total;

  async function upload(index: number, file: File) {
    setStates((s) => s.map((v, i) => (i === index ? "uploading" : v)));
    setErrors((e) => e.map((v, i) => (i === index ? null : v)));

    const fd = new FormData();
    fd.set("file", file);
    fd.set("itemIndex", String(index));

    try {
      const res = await fetch(`/api/portal/${token}/upload`, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStates((s) => s.map((v, i) => (i === index ? "error" : v)));
        setErrors((e) => e.map((v, i) => (i === index ? json.error ?? "Upload failed." : v)));
        return;
      }
      setItems((prev) => prev.map((it, i) => (i === index ? { ...it, fulfilled: true } : it)));
      setStates((s) => s.map((v, i) => (i === index ? "done" : v)));
    } catch {
      setStates((s) => s.map((v, i) => (i === index ? "error" : v)));
      setErrors((e) => e.map((v, i) => (i === index ? "Network error. Please try again." : v)));
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10 sm:py-16">
      {/* Header */}
      <header className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          {firmName ?? "Your accountant"}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{title}</h1>
        {message && (
          <p className="mx-auto mt-3 max-w-prose text-sm text-muted-foreground">{message}</p>
        )}
      </header>

      {/* Progress banner */}
      <div className="mb-6 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {allDone ? "All documents received" : "Upload progress"}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {done} of {total}
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {allDone && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
          <div>
            <p className="font-medium text-foreground">Thank you! Everything is in.</p>
            <p className="text-muted-foreground">
              Your accountant has been notified. You can close this page.
            </p>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="space-y-3">
        {items.map((item, i) => (
          <ItemRow
            key={i}
            label={item.label}
            state={states[i]}
            error={errors[i]}
            onPick={(file) => upload(i, file)}
          />
        ))}
      </div>

      {total === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          There are no items to upload for this request.
        </p>
      )}

      <footer className="mt-auto pt-10 text-center text-xs text-muted-foreground">
        <p className="flex items-center justify-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />
          Your files are transmitted securely and visible only to your accounting firm.
        </p>
        <p className="mt-1">Secured by KarbonCopy</p>
      </footer>
    </div>
  );
}

function ItemRow({
  label,
  state,
  error,
  onPick,
}: {
  label: string;
  state: ItemState;
  error: string | null;
  onPick: (file: File) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const done = state === "done";
  const busy = state === "uploading";

  return (
    <div
      onDragOver={(e) => {
        if (done || busy) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (done || busy) return;
        const f = e.dataTransfer.files?.[0];
        if (f) onPick(f);
      }}
      className={cn(
        "rounded-xl border p-4 transition-colors",
        done && "border-success/40 bg-success/5",
        dragOver && !done && "border-primary bg-primary/5",
        state === "error" && "border-destructive/40",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            done ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {done ? <Check className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            {done
              ? "Received — thank you"
              : busy
                ? "Uploading…"
                : "Drag a file here or choose one"}
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = "";
          }}
        />

        {done ? (
          <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
            Replace
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Uploading
              </>
            ) : (
              <>
                <UploadCloud className="h-4 w-4" /> Upload
              </>
            )}
          </Button>
        )}
      </div>

      {state === "error" && error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}
