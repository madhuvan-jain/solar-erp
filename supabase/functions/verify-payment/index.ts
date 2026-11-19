// POST { orderId, paymentId, signature } with the payer's login token, right after Razorpay Checkout succeeds.
// Checks Razorpay's signature with our secret, asks Razorpay that the payment is captured for this order and amount,
// then extends the subscription (once). The webhook does the same if the browser closes before this call.
import { checkoutSignatureOk, isOrderId, isPaymentId, paymentMatches, razorpayAuth } from '../_shared/billing.ts';
import { admin, caller, env, HttpError, serve } from '../_shared/server.ts';

serve(async (req) => {
  const user = await caller(req);
  if (!user) throw new HttpError(401, 'Please sign in again.');
  const { orderId, paymentId, signature } = await req.json().catch(() => ({}));
  if (!isOrderId(orderId) || !isPaymentId(paymentId) || typeof signature !== 'string') throw new HttpError(400, 'Incomplete payment details.');

  const keyId = env('RAZORPAY_KEY_ID');
  const keySecret = env('RAZORPAY_KEY_SECRET');
  if (!(await checkoutSignatureOk(keySecret, orderId, paymentId, signature))) throw new HttpError(400, 'This payment could not be verified.');

  const db = admin();
  // The order must be one we made, for the caller's own business.
  const { data: order } = await db.from('subscription_payments').select('business_id, amount_paise, status').eq('order_id', orderId).maybeSingle();
  const { data: me } = await db.from('profiles').select('business_id').eq('id', user).maybeSingle();
  if (!order || !me || order.business_id !== me.business_id) throw new HttpError(404, 'Unknown order.');

  const auth = razorpayAuth(keyId, keySecret);
  let p = await (await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, { headers: { Authorization: auth } })).json().catch(() => null);
  // Accounts with manual capture: capture it now, for exactly the order's amount — but never a second payment for an
  // order already paid (it would be charged and add nothing; left uncaptured, the bank releases it by itself).
  if (order.status === 'paid' && p?.status === 'authorized') return { already: true, notCaptured: true };
  if (p?.status === 'authorized' && p.order_id === orderId && p.amount === order.amount_paise) {
    p = await (await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/capture`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: order.amount_paise, currency: 'INR' }),
    })).json().catch(() => null);
  }
  if (!paymentMatches(p, orderId, order.amount_paise)) throw new HttpError(400, 'The payment is not complete yet. If money was taken, it will be added within a few minutes.');

  const { data, error } = await db.rpc('apply_subscription_payment', { p_order: orderId, p_payment: paymentId, p_amount: p.amount });
  if (error) throw error;
  return data; // { already, paidUntil }
});
