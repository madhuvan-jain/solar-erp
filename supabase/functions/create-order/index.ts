// POST { plan: "1m" | "3m" | "6m" | "12m" } with the admin's login token.
// Creates a Razorpay order for the plan's price (from the database, never from the app) and records it.
// Returns what Razorpay Checkout needs: { orderId, amount, currency, keyId, label, business }.
import { isPlanId, razorpayAuth, receiptFor } from '../_shared/billing.ts';
import { admin, caller, env, HttpError, serve } from '../_shared/server.ts';

serve(async (req) => {
  const user = await caller(req);
  if (!user) throw new HttpError(401, 'Please sign in again.');
  const { plan } = await req.json().catch(() => ({}));
  if (!isPlanId(plan)) throw new HttpError(400, 'Choose a plan.');

  const db = admin();
  const { data: quote, error: qe } = await db.rpc('billing_quote', { p_user: user, p_plan: plan });
  if (qe) throw qe;
  const { business, amount, label } = quote as { business: string; amount: number; label: string };

  const keyId = env('RAZORPAY_KEY_ID');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: razorpayAuth(keyId, env('RAZORPAY_KEY_SECRET')), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, currency: 'INR', receipt: receiptFor(business), notes: { business, plan, user } }),
  });
  const order = await res.json().catch(() => null);
  if (!res.ok || !order?.id) {
    console.error('Razorpay order failed', res.status, order);
    throw new HttpError(502, 'The payment service is not answering. Please try again in a minute.');
  }
  if (order.amount !== amount) throw new HttpError(502, 'The payment service returned a different amount.');

  const { error: re } = await db.rpc('billing_record_order', { p_user: user, p_plan: plan, p_order: order.id, p_amount: amount });
  if (re) throw re;
  return { orderId: order.id, amount, currency: 'INR', keyId, label, business };
});
