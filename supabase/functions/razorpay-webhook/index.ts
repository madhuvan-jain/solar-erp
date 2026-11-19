// Razorpay calls this (Dashboard → Settings → Webhooks, events: payment.captured, order.paid) after each payment,
// so a subscription is extended even if the payer's browser closed before the app could confirm it.
// Deployed without the gateway's login check (Razorpay has no login): scripts/deploy-payments.sh does that.
// Only requests signed with RAZORPAY_WEBHOOK_SECRET are acted on.
import { isOrderId, isPaymentId, webhookSignatureOk } from '../_shared/billing.ts';
import { admin } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  const raw = await req.text();
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') || '';
  if (!(await webhookSignatureOk(secret, raw, req.headers.get('X-Razorpay-Signature')))) return new Response('Bad signature', { status: 401 });

  let event: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string; status?: string } } } };
  try { event = JSON.parse(raw); } catch { return new Response('Bad body', { status: 400 }); }
  if (event.event !== 'payment.captured' && event.event !== 'order.paid') return new Response('Ignored', { status: 200 });

  const p = event.payload?.payment?.entity;
  if (!p || p.status !== 'captured' || p.currency !== 'INR' || !isOrderId(p.order_id) || !isPaymentId(p.id) || typeof p.amount !== 'number') {
    return new Response('Ignored', { status: 200 });
  }
  const { error } = await admin().rpc('apply_subscription_payment', { p_order: p.order_id, p_payment: p.id, p_amount: p.amount });
  if (error) {
    // Not one of our subscription orders (another product on the same Razorpay account): nothing to do.
    if (/Unknown order/.test(error.message)) return new Response('Ignored', { status: 200 });
    // A wrong amount or a reused payment is a problem for a person, not something a retry fixes.
    if (/does not match|already used|no longer exists/.test(error.message)) { console.error('Payment refused', p.id, error.message); return new Response('Refused', { status: 200 }); }
    console.error(error);
    return new Response('Try again', { status: 500 }); // Razorpay retries
  }
  return new Response('OK', { status: 200 });
});
