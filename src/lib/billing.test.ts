// @vitest-environment node
// The payment server's checks (supabase/functions/_shared/billing.ts): signatures, ids, amounts, CORS.
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  checkoutSignatureOk, corsHeaders, hmacHex, isOrderId, isPaymentId, isPlanId, paymentMatches, publicMessage, receiptFor, safeEqual,
  webhookSignatureOk,
} from '../../supabase/functions/_shared/billing';

const SECRET = 'test_secret_123';
const sign = (msg: string, secret = SECRET) => createHmac('sha256', secret).update(msg).digest('hex');

describe('payment checks', () => {
  it('HMAC matches Node’s (the algorithm Razorpay documents)', async () => {
    expect(await hmacHex(SECRET, 'order_A|pay_B')).toBe(sign('order_A|pay_B'));
    expect(await hmacHex('k', '')).toBe(sign('', 'k'));
  });

  it('Checkout signature: right order, payment and secret only', async () => {
    const good = sign('order_Kx1|pay_Ly2');
    expect(await checkoutSignatureOk(SECRET, 'order_Kx1', 'pay_Ly2', good)).toBe(true);
    expect(await checkoutSignatureOk(SECRET, 'order_Kx1', 'pay_Ly2', good.toUpperCase())).toBe(true);
    expect(await checkoutSignatureOk(SECRET, 'order_Kx1', 'pay_OTHER', good)).toBe(false); // another payment
    expect(await checkoutSignatureOk(SECRET, 'order_OTHER', 'pay_Ly2', good)).toBe(false); // another order
    expect(await checkoutSignatureOk('wrong', 'order_Kx1', 'pay_Ly2', good)).toBe(false);
    expect(await checkoutSignatureOk(SECRET, 'order_Kx1', 'pay_Ly2', '')).toBe(false);
    expect(await checkoutSignatureOk('', 'order_Kx1', 'pay_Ly2', sign('order_Kx1|pay_Ly2', ''))).toBe(false); // no secret set: never ok
  });

  it('webhook signature covers the exact body', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', amount: 100000 } } } });
    expect(await webhookSignatureOk(SECRET, body, sign(body))).toBe(true);
    expect(await webhookSignatureOk(SECRET, body.replace('100000', '1'), sign(body))).toBe(false); // amount changed
    expect(await webhookSignatureOk(SECRET, body, null)).toBe(false);
    expect(await webhookSignatureOk('', body, sign(body, ''))).toBe(false);
  });

  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('ids and plans', () => {
    expect(isPlanId('12m')).toBe(true);
    expect(isPlanId('24m')).toBe(true); // well-formed; the database says whether it exists
    expect(isPlanId("1m'; drop table plans; --")).toBe(false);
    expect(isPlanId({})).toBe(false);
    expect(isOrderId('order_Ndx7Lp0Abc123')).toBe(true);
    expect(isOrderId('order_../../x')).toBe(false);
    expect(isPaymentId('pay_29QQoUBi66xm2f')).toBe(true);
    expect(isPaymentId('pay_1 or 1=1')).toBe(false);
    const r = receiptFor('3f2a9c4e-1111-2222-3333-444455556666', 1_700_000_000_000);
    expect(r.length).toBeLessThanOrEqual(40);
    expect(r).toMatch(/^sub_3f2a9c4e1111_/);
  });

  it('a payment counts only when captured, for this order, in rupees, for the exact amount', () => {
    const p = { status: 'captured', order_id: 'order_A', amount: 250000, currency: 'INR' };
    expect(paymentMatches(p, 'order_A', 250000)).toBe(true);
    expect(paymentMatches({ ...p, status: 'authorized' }, 'order_A', 250000)).toBe(false);
    expect(paymentMatches({ ...p, status: 'failed' }, 'order_A', 250000)).toBe(false);
    expect(paymentMatches({ ...p, order_id: 'order_B' }, 'order_A', 250000)).toBe(false);
    expect(paymentMatches({ ...p, amount: 100 }, 'order_A', 250000)).toBe(false);
    expect(paymentMatches({ ...p, currency: 'USD' }, 'order_A', 250000)).toBe(false);
    expect(paymentMatches(null, 'order_A', 250000)).toBe(false);
  });

  it('CORS: only our website and the app shells', () => {
    const allowed = 'https://app.example.in, https://example.in';
    expect(corsHeaders('https://app.example.in', allowed)['Access-Control-Allow-Origin']).toBe('https://app.example.in');
    expect(corsHeaders('capacitor://localhost', allowed)['Access-Control-Allow-Origin']).toBe('capacitor://localhost');
    expect(corsHeaders('https://evil.example', allowed)['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsHeaders(null, allowed)['Access-Control-Allow-Origin']).toBeUndefined();
    // supabase-js sends these with functions.invoke (newer versions more); a missing one breaks every browser call.
    const allowedHeaders = corsHeaders('https://app.example.in', allowed)['Access-Control-Allow-Headers'].split(', ');
    for (const h of ['authorization', 'x-client-info', 'apikey', 'content-type', 'x-retry-count']) expect(allowedHeaders).toContain(h);
  });

  it('only "ERP:" database messages reach the person', () => {
    expect(publicMessage({ message: 'ERP: Unknown plan.' })).toBe('Unknown plan.');
    expect(publicMessage(new Error('connection refused at 10.0.0.1:5432'))).not.toMatch(/10\.0\.0\.1/);
  });
});
