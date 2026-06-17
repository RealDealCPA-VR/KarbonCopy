"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMinutes, formatMoneyCents, cn } from "@/lib/utils";
import {
  createInvoice,
  updateInvoice,
  getUnbilledTime,
  type LineDraft,
  type WipGroup,
} from "@/app/(app)/billing/actions";

export type EditorClient = { id: string; name: string };

export type EditorLine = {
  key: string;
  description: string;
  quantity: string; // controlled text
  unitDollars: string; // controlled text (dollars)
  workItemId?: string | null;
  timeEntryIds?: string[] | null;
};

export type EditorInvoice = {
  id: string;
  organizationId: string | null;
  issueDate: string | null; // yyyy-mm-dd
  dueDate: string | null;
  notes: string | null;
  terms: string | null;
  taxBps: number;
  discountCents: number;
  lines: { description: string; quantity: number; unitCents: number; workItemId: string | null; timeEntryIds: string[] | null }[];
};

let _k = 0;
const nextKey = () => `l${_k++}`;

function emptyLine(): EditorLine {
  return { key: nextKey(), description: "", quantity: "1", unitDollars: "0.00" };
}

function centsToDollars(c: number): string {
  return (c / 100).toFixed(2);
}

export function InvoiceEditor({
  clients,
  defaultOrgId = null,
  invoice,
}: {
  clients: EditorClient[];
  defaultOrgId?: string | null;
  invoice?: EditorInvoice;
}) {
  const router = useRouter();
  const editing = Boolean(invoice);

  const [orgId, setOrgId] = React.useState<string>(invoice?.organizationId ?? defaultOrgId ?? "none");
  const [issueDate, setIssueDate] = React.useState<string>(
    invoice?.issueDate ?? new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = React.useState<string>(invoice?.dueDate ?? "");
  const [taxPct, setTaxPct] = React.useState<string>(
    invoice ? (invoice.taxBps / 100).toString() : "0",
  );
  const [discountDollars, setDiscountDollars] = React.useState<string>(
    invoice ? centsToDollars(invoice.discountCents) : "0.00",
  );
  const [notes, setNotes] = React.useState<string>(invoice?.notes ?? "");
  const [terms, setTerms] = React.useState<string>(invoice?.terms ?? "Net 30");
  const [lines, setLines] = React.useState<EditorLine[]>(
    invoice && invoice.lines.length
      ? invoice.lines.map((l) => ({
          key: nextKey(),
          description: l.description,
          quantity: String(l.quantity),
          unitDollars: centsToDollars(l.unitCents),
          workItemId: l.workItemId,
          timeEntryIds: l.timeEntryIds,
        }))
      : [emptyLine()],
  );
  const [pending, setPending] = React.useState<null | "draft" | "send">(null);
  const [wipLoading, setWipLoading] = React.useState(false);

  const updateLine = (key: string, patch: Partial<EditorLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const lineCents = (l: EditorLine) =>
    Math.round((Number(l.quantity) || 0) * Math.round((Number(l.unitDollars) || 0) * 100));

  const subtotal = lines.reduce((s, l) => s + lineCents(l), 0);
  const discountCents = Math.max(0, Math.min(Math.round((Number(discountDollars) || 0) * 100), subtotal));
  const taxBps = Math.max(0, Math.round((Number(taxPct) || 0) * 100));
  const taxable = Math.max(0, subtotal - discountCents);
  const taxCents = Math.round((taxable * taxBps) / 10000);
  const total = taxable + taxCents;

  async function pullWip() {
    if (orgId === "none") {
      toast.error("Pick a client first.");
      return;
    }
    setWipLoading(true);
    try {
      const res = await getUnbilledTime(orgId);
      setWipLoading(false);
      if (!res.groups.length) {
        toast.info("No unbilled, approved billable time for this client.");
        return;
      }
      const wipLines: EditorLine[] = res.groups.map((g: WipGroup) => ({
        key: nextKey(),
        description: `${g.label} — ${formatMinutes(g.minutes)}`,
        // Enough precision that quantity × hourly rate reproduces the exact
        // billable cents (toFixed(2) on hours dropped up to a cent per line);
        // trailing zeros are trimmed so clean values still read "1.5".
        quantity: String(Number((g.minutes / 60).toFixed(6))),
        unitDollars: centsToDollars(g.rateCents),
        workItemId: g.workItemId,
        timeEntryIds: g.entryIds,
      }));
      setLines((prev) => {
        const existing = prev.filter((l) => l.description.trim() || l.timeEntryIds?.length);
        return [...existing, ...wipLines];
      });
      toast.success(
        `Added ${res.groups.length} line${res.groups.length === 1 ? "" : "s"} from unbilled time (${formatMinutes(res.totalMinutes)}).`,
      );
    } catch {
      setWipLoading(false);
      toast.error("Could not load unbilled time.");
    }
  }

  async function submit(mode: "draft" | "send") {
    if (orgId === "none") {
      toast.error("Pick a client.");
      return;
    }
    const draftLines: LineDraft[] = lines
      .filter((l) => l.description.trim())
      .map((l) => ({
        description: l.description.trim(),
        quantity: Number(l.quantity) || 0,
        unitCents: Math.round((Number(l.unitDollars) || 0) * 100),
        workItemId: l.workItemId ?? null,
        timeEntryIds: l.timeEntryIds ?? null,
      }));
    if (!draftLines.length) {
      toast.error("Add at least one line item with a description.");
      return;
    }

    const payload = {
      organizationId: orgId,
      issueDate: issueDate || null,
      dueDate: dueDate || null,
      notes: notes || null,
      terms: terms || null,
      taxBps,
      discountCents,
      status: mode === "send" ? ("sent" as const) : ("draft" as const),
      lines: draftLines,
    };

    setPending(mode);
    const res = editing
      ? await updateInvoice({ id: invoice!.id, ...payload })
      : await createInvoice(payload);
    setPending(null);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      editing ? "Invoice updated" : mode === "send" ? "Invoice created & marked sent" : "Draft saved",
    );
    if (editing) {
      router.push(`/billing/${invoice!.id}`);
    } else if ("data" in res && res.data?.id) {
      router.push(`/billing/${res.data.id}`);
    } else {
      router.push("/billing");
    }
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Client *</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select a client…</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issueDate">Issue date</Label>
              <Input
                id="issueDate"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dueDate">Due date</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Line items</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={pullWip}
              disabled={wipLoading}
            >
              {wipLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate from unbilled time
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* header row */}
            <div className="hidden grid-cols-[1fr_80px_120px_120px_36px] items-center gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid">
              <span>Description</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            {lines.map((l) => (
              <div
                key={l.key}
                className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_80px_120px_120px_36px]"
              >
                <Input
                  value={l.description}
                  onChange={(e) => updateLine(l.key, { description: e.target.value })}
                  placeholder="Description"
                />
                <Input
                  value={l.quantity}
                  onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  placeholder="1"
                />
                <Input
                  value={l.unitDollars}
                  onChange={(e) => updateLine(l.key, { unitDollars: e.target.value })}
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  placeholder="0.00"
                />
                <div className="px-2 text-right text-sm tabular-nums text-muted-foreground sm:px-0">
                  {formatMoneyCents(lineCents(l))}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeLine(l.key)}
                  aria-label="Remove line"
                  disabled={lines.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="h-4 w-4" /> Add line
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes & terms</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="terms">Terms</Label>
              <Input id="terms" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Net 30" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">Notes (shown on the invoice)</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary rail */}
      <div className="space-y-6">
        <Card className="sticky top-6">
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SummaryRow label="Subtotal" value={formatMoneyCents(subtotal)} />
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="discount" className="text-sm text-muted-foreground">
                Discount
              </Label>
              <div className="relative w-28">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="discount"
                  value={discountDollars}
                  onChange={(e) => setDiscountDollars(e.target.value)}
                  inputMode="decimal"
                  className="h-8 pl-5 text-right tabular-nums"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="tax" className="text-sm text-muted-foreground">
                Tax rate
              </Label>
              <div className="relative w-28">
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
                <Input
                  id="tax"
                  value={taxPct}
                  onChange={(e) => setTaxPct(e.target.value)}
                  inputMode="decimal"
                  className="h-8 pr-6 text-right tabular-nums"
                />
              </div>
            </div>
            <SummaryRow label="Tax" value={formatMoneyCents(taxCents)} muted />
            <Separator />
            <div className="flex items-center justify-between">
              <span className="font-semibold">Total</span>
              <span className="text-xl font-bold tabular-nums">{formatMoneyCents(total)}</span>
            </div>

            <div className="space-y-2 pt-2">
              <Button className="w-full" onClick={() => submit("send")} disabled={pending !== null}>
                {pending === "send" ? "Saving…" : editing ? "Save & mark sent" : "Create & send"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => submit("draft")}
                disabled={pending !== null}
              >
                {pending === "draft" ? "Saving…" : "Save as draft"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", muted && "text-muted-foreground")}>{value}</span>
    </div>
  );
}
