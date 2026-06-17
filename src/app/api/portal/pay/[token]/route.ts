import { NextResponse } from "next/server";
import { findInvoiceByPayToken, stripeEnabled, stripe } from "@/lib/billing";
import { checkRateLimit } from "@/app/api/documents/_ratelimit";

function ipOf(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0]?.trim() : "") || req.headers.get("x-real-ip") || "unknown";
}

/**
 * PUBLIC (token-guarded) — create a Stripe Checkout session for an invoice's
 * remaining balance and return its URL. No staff/client session required; the
 * high-entropy payToken is the capability.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rl = checkRateLimit(`pay:${token}:${ipOf(req)}`, 20, 10 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  if (!stripeEnabled()) {
    return NextResponse.json({ error: "Online payment is not enabled. Please contact the firm." }, { status: 503 });
  }

  let inv;
  try {
    inv = await findInvoiceByPayToken(token);
  } catch (err) {
    console.error("[portal/pay] invoice lookup failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not load the invoice. Please try again." }, { status: 500 });
  }
  if (!inv || inv.status === "void") {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  const due = inv.totalCents - inv.amountPaidCents;
  if (due <= 0) return NextResponse.json({ error: "This invoice is already paid." }, { status: 400 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      success_url: `${appUrl}/portal/pay/${token}?paid=1`,
      cancel_url: `${appUrl}/portal/pay/${token}`,
      client_reference_id: inv.id,
      metadata: { invoiceId: inv.id, invoiceNumber: inv.number },
      payment_intent_data: { metadata: { invoiceId: inv.id, invoiceNumber: inv.number } },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: (inv.currency || "usd").toLowerCase(),
            unit_amount: due,
            product_data: { name: `Invoice ${inv.number}` },
          },
        },
      ],
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Public, internet-facing endpoint — log the raw Stripe error but return a
    // generic message (don't leak SDK/config details to anonymous clients).
    console.error("[portal/pay] checkout failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again or contact the firm." },
      { status: 502 },
    );
  }
}
