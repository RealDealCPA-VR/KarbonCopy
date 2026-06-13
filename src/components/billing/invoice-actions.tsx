"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Send, CreditCard, Ban, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sendInvoice, voidInvoice, deleteInvoice, createCheckoutLink } from "@/app/(app)/billing/actions";
import type { InvoiceStatus } from "@/db/schema";

export function InvoiceActions({
  invoiceId,
  status,
  editable,
  isManager,
  stripeOn,
  balanceCents,
  hasPayments,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  editable: boolean;
  isManager: boolean;
  stripeOn: boolean;
  balanceCents: number;
  hasPayments: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<null | "void" | "delete">(null);

  const canSend = status === "draft";
  const canCollect = stripeOn && status !== "void" && status !== "paid" && balanceCents > 0;

  async function doSend() {
    setBusy("send");
    const res = await sendInvoice(invoiceId);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Invoice marked sent");
    router.refresh();
  }

  async function doCheckout() {
    setBusy("checkout");
    const res = await createCheckoutLink(invoiceId);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    try {
      await navigator.clipboard.writeText(res.data!.url);
      toast.success("Stripe payment link copied to clipboard");
    } catch {
      toast.success("Payment link created");
    }
    window.open(res.data!.url, "_blank", "noopener,noreferrer");
    router.refresh();
  }

  async function doVoid() {
    setBusy("void");
    const res = await voidInvoice(invoiceId);
    setBusy(null);
    setConfirm(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Invoice voided");
    router.refresh();
  }

  async function doDelete() {
    setBusy("delete");
    const res = await deleteInvoice(invoiceId);
    setBusy(null);
    setConfirm(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Invoice deleted");
    router.push("/billing");
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {canSend && (
          <Button onClick={doSend} disabled={busy !== null}>
            {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        )}
        {canCollect && (
          <Button variant={canSend ? "outline" : "default"} onClick={doCheckout} disabled={busy !== null}>
            {busy === "checkout" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4" />
            )}
            Payment link
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {editable && (
              <DropdownMenuItem asChild>
                <Link href={`/billing/${invoiceId}/edit`}>
                  <Pencil className="h-4 w-4" /> Edit invoice
                </Link>
              </DropdownMenuItem>
            )}
            {isManager && (
              <>
                <DropdownMenuSeparator />
                {status !== "void" && status !== "paid" && (
                  <DropdownMenuItem onClick={() => setConfirm("void")} className="text-destructive">
                    <Ban className="h-4 w-4" /> Void invoice
                  </DropdownMenuItem>
                )}
                {!hasPayments && (
                  <DropdownMenuItem onClick={() => setConfirm("delete")} className="text-destructive">
                    <Trash2 className="h-4 w-4" /> Delete invoice
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "delete" ? "Delete this invoice?" : "Void this invoice?"}</DialogTitle>
            <DialogDescription>
              {confirm === "delete"
                ? "This permanently removes the invoice and its line items. This cannot be undone."
                : "Voiding marks the invoice as cancelled. It will no longer count toward outstanding balances."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirm === "delete" ? doDelete : doVoid}
              disabled={busy !== null}
            >
              {busy ? "Working…" : confirm === "delete" ? "Delete" : "Void"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
