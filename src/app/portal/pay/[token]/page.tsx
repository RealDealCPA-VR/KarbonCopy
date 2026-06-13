import { findInvoiceByPayToken, stripeEnabled } from "@/lib/billing";
import { formatMoneyCents } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { PayButton } from "./pay-button";

export const dynamic = "force-dynamic";

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { token } = await params;
  const { paid } = await searchParams;
  const inv = await findInvoiceByPayToken(token);

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle>Invoice payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">{children}</CardContent>
      </Card>
    </div>
  );

  if (!inv || inv.status === "void") {
    return <Shell><p className="text-sm text-muted-foreground">This payment link is invalid or expired.</p></Shell>;
  }

  const due = inv.totalCents - inv.amountPaidCents;
  const isPaid = inv.status === "paid" || due <= 0 || paid === "1";

  if (isPaid) {
    return (
      <Shell>
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
        <p className="font-medium">Thank you — invoice {inv.number} is paid.</p>
        <p className="text-sm text-muted-foreground">A receipt has been recorded with your firm.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div>
        <div className="text-sm text-muted-foreground">Invoice {inv.number}</div>
        <div className="mt-1 text-3xl font-bold tabular-nums">{formatMoneyCents(due)}</div>
        <div className="text-xs text-muted-foreground">due</div>
      </div>
      {stripeEnabled() ? (
        <PayButton token={token} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Online payment isn&apos;t enabled. Please contact the firm to pay this invoice.
        </p>
      )}
      <p className="text-xs text-muted-foreground">Secured by KarbonCopy · payments processed by Stripe</p>
    </Shell>
  );
}
