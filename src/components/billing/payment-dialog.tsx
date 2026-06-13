"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recordPayment } from "@/app/(app)/billing/actions";
import { formatMoneyCents } from "@/lib/utils";
import type { PaymentMethod } from "@/db/schema";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH" },
  { value: "wire", label: "Wire" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "manual", label: "Other" },
];

export function PaymentDialog({
  invoiceId,
  balanceCents,
}: {
  invoiceId: string;
  balanceCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState((balanceCents / 100).toFixed(2));
  const [method, setMethod] = React.useState<PaymentMethod>("check");
  const [reference, setReference] = React.useState("");
  const [receivedAt, setReceivedAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open) setAmount((balanceCents / 100).toFixed(2));
  }, [open, balanceCents]);

  async function submit() {
    const cents = Math.round((Number(amount) || 0) * 100);
    if (cents <= 0) {
      toast.error("Enter a payment amount greater than zero.");
      return;
    }
    setPending(true);
    const res = await recordPayment({
      invoiceId,
      amountCents: cents,
      method,
      reference: reference || null,
      receivedAt: receivedAt || null,
    });
    setPending(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Payment recorded");
    setOpen(false);
    setReference("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="h-4 w-4" /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            Balance due {formatMoneyCents(balanceCents)}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="pl-6 tabular-nums"
                autoFocus
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="receivedAt">Received</Label>
            <Input
              id="receivedAt"
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reference">Reference</Label>
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Check #, memo…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
