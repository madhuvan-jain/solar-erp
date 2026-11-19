// Shared by the payment functions (Deno, on Supabase) and their tests (Node). No imports: only Web Crypto and fetch.
//
// Security model, in short:
//  - The app never decides a price or a subscription date. It asks for a plan; the server reads the price from the
//    database (plans table), creates the Razorpay order for exactly that amount, and records it.
//  - A payment counts only when Razorpay's signature checks out with our secret (which never leaves the server),
//    Razorpay itself confirms the payment is captured, for this order, for this amount — and then only once.

/** Hex HMAC-SHA256 of `message` with `secret`. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings in time that does not depend on where they differ (no timing hints for forgers). */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Razorpay Checkout's signature: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export async function checkoutSignatureOk(keySecret: string, orderId: string, paymentId: string, signature: string): Promise<boolean> {
  if (!keySecret || !orderId || !paymentId || !signature) return false;
  return safeEqual(await hmacHex(keySecret, `${orderId}|${paymentId}`), String(signature).toLowerCase());
}

/** A webhook's signature: HMAC-SHA256 of the raw request body with the webhook secret. */
export async function webhookSignatureOk(webhookSecret: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!webhookSecret || !signature) return false;
  return safeEqual(await hmacHex(webhookSecret, rawBody), signature.toLowerCase());
}

/** A plan id as stored in the plans table ("1m", "12m", or one you add later); the database decides if it exists. */
export const isPlanId = (p: unknown): p is string => typeof p === 'string' && /^[a-z0-9_-]{1,16}$/.test(p);

/** Razorpay ids look like "order_XXXXXXXXXXXXXX" / "pay_XXXXXXXXXXXXXX". */
export const isOrderId = (s: unknown): s is string => typeof s === 'string' && /^order_[A-Za-z0-9]{6,40}$/.test(s);
export const isPaymentId = (s: unknown): s is string => typeof s === 'string' && /^pay_[A-Za-z0-9]{6,40}$/.test(s);

/** A receipt id for the order (Razorpay allows at most 40 characters). */
export const receiptFor = (business: string, now = Date.now()) => `sub_${business.replace(/-/g, '').slice(0, 12)}_${now.toString(36)}`.slice(0, 40);

/**
 * Whether a payment Razorpay reports can be applied to our order: captured (money taken), for this order, in rupees,
 * for exactly the order's amount.
 */
export function paymentMatches(p: { status?: string; order_id?: string; amount?: number; currency?: string } | null | undefined,
  orderId: string, amountPaise: number): boolean {
  return !!p && p.status === 'captured' && p.order_id === orderId && p.currency === 'INR' && p.amount === amountPaise;
}

/**
 * CORS: the browser may call the functions only from our own website (and the Android/iOS app shells).
 * `allowed` is the comma-separated ALLOWED_ORIGINS secret, e.g. "https://app.example.in,https://example.in".
 */
export function corsHeaders(origin: string | null, allowed: string): Record<string, string> {
  const list = allowed.split(',').map((s) => s.trim()).filter(Boolean);
  const app = ['capacitor://localhost', 'https://localhost', 'http://localhost'];
  const ok = !!origin && (list.includes(origin) || app.includes(origin));
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin! } : {}),
    // Every header supabase-js may send (newer versions add retry and tracing headers; Supabase's CORS guide).
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-retry-count, traceparent, tracestate, baggage',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Turns a database error ("ERP: …") into the message shown to the person; anything else stays private. */
export function publicMessage(e: unknown): string {
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '');
  const i = m.indexOf('ERP: ');
  return i >= 0 ? m.slice(i + 5) : 'The payment could not be completed. Please try again, or contact us.';
}

/** Basic-auth header for the Razorpay API. */
export const razorpayAuth = (keyId: string, keySecret: string) => 'Basic ' + btoa(`${keyId}:${keySecret}`);
