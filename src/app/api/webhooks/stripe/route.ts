/**
 * POST /api/webhooks/stripe — PUBLIC (allowlisted in middleware).
 *
 * Verifies the Stripe signature against STRIPE_WEBHOOK_SECRET, then on
 * checkout.session.completed / payment_intent.succeeded records a payment and
 * marks the invoice paid. Idempotent on the Stripe processor reference, so
 * Stripe's at-least-once delivery never double-credits an invoice.
 *
 * No card data ever reaches this app — only Stripe's signed event payload.
 */
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { emitToUser } from "@/server/realtime";
import { stripe, stripeEnabled, applyStripePayment } from "@/lib/billing";
import { checkRateLimit, clientIp } from "@/app/api/documents/_ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_LIMIT = 240;
const RL_WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  if (!stripeEnabled() || !process.env.STRIPE_WEBHOOK_SECRET) {
    // Webhooks are meaningless without Stripe configured.
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  // Light throttle to blunt unsigned floods before signature work.
  const rl = checkRateLimit(`stripe-webhook:${clientIp(req)}`, RL_LIMIT, RL_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  // Raw body is required for signature verification — read as text, do not parse.
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    // Public endpoint — log the SDK detail server-side, return a generic body.
    console.error("[stripe] webhook signature verification failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Webhook signature verification failed." }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid") {
        const invoiceId =
          (session.metadata?.invoiceId as string | undefined) ||
          (session.client_reference_id as string | undefined) ||
          null;
        // Always key idempotency on the payment_intent id so this event and a
        // later payment_intent.succeeded for the same payment dedupe correctly.
        // (Never fall back to session.id — a divergent ref would double-credit.)
        const processorRef =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null;
        const amountCents = session.amount_total ?? 0;
        if (invoiceId && processorRef && amountCents > 0) {
          await applyAndNotify({ invoiceId, amountCents, processorRef, reference: processorRef });
        } else if (invoiceId && !processorRef) {
          // No payment_intent yet (rare) — let payment_intent.succeeded record it.
          console.warn("[stripe] checkout.session.completed without payment_intent; deferring to payment_intent.succeeded");
        }
      }
    } else if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const invoiceId = (pi.metadata?.invoiceId as string | undefined) || null;
      const amountCents = pi.amount_received || pi.amount || 0;
      if (invoiceId && amountCents > 0) {
        await applyAndNotify({ invoiceId, amountCents, processorRef: pi.id, reference: pi.id });
      }
    }
  } catch (err) {
    // Log the detail server-side; return a 500 so Stripe retries, but a GENERIC
    // body — this is a public, internet-facing endpoint and must not leak raw
    // DB/SDK error text.
    console.error("[stripe] webhook processing error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }

  // Always 200 for handled/ignored events so Stripe stops retrying.
  return NextResponse.json({ received: true });
}

/** Apply the payment, then notify the client's RM (outside the sync tx). */
async function applyAndNotify(opts: {
  invoiceId: string;
  amountCents: number;
  processorRef: string;
  reference?: string | null;
}) {
  const res = applyStripePayment(opts);
  if (!res.applied) return;

  // Look up the org's relationship manager and notify on a successful payment.
  const [inv] = await db
    .select({ organizationId: schema.invoices.organizationId, number: schema.invoices.number })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, res.invoiceId))
    .limit(1);

  let rmId: string | null = null;
  if (inv?.organizationId) {
    const [org] = await db
      .select({ ownerId: schema.organizations.ownerId })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, inv.organizationId))
      .limit(1);
    rmId = org?.ownerId ?? null;
  }

  if (rmId) {
    // Best-effort: the payment is already recorded, so a notification failure must
    // not make the webhook return 500 (which would make Stripe retry a done payment).
    try {
      const [notif] = await db
        .insert(schema.notifications)
        .values({
          userId: rmId,
          type: "payment",
          title: "Payment received",
          body: `Invoice ${res.number} was paid online${res.status === "paid" ? " in full" : ""}.`,
          entityKind: "invoice",
          entityId: res.invoiceId,
        })
        .returning();
      if (notif) emitToUser(rmId, "notification", notif);
    } catch (err) {
      console.error("[stripe] payment notification failed:", err instanceof Error ? err.message : "unknown");
    }
  }
}
