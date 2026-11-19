// @vitest-environment node
// Runs the real payment functions (supabase/functions/*/index.ts) end to end: the real database rules (PGlite with
// supabase/schema.sql), a stand-in for Razorpay's API, and real HMAC signatures. Only the network is simulated.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHmac } from 'node:crypto';
import { useTestDb } from '../test/fakeSupabaseJsr';

const KEY_ID = 'rzp_test_KEYID12345';
const KEY_SECRET = 'key_secret_for_tests';
const WEBHOOK_SECRET = 'webhook_secret_for_tests_123';
const SITE = 'https://app.example.in';
const sign = (msg: string, secret: string) => createHmac('sha256', secret).update(msg).digest('hex');

type Handler = (req: Request) => Promise<Response>;
const handlers: Record<string, Handler> = {};
let db: PGlite;
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const q = (sql: string, p: unknown[] = []) => db.query<Record<string, unknown>>(sql, p);

// Razorpay's API, as far as the functions use it.
const rz = { orders: [] as { amount: number; auth: string }[], payments: {} as Record<string, Record<string, unknown>>, captures: 0, nextOrder: 1 };
const realFetch = globalThis.fetch;

async function signup(key: string, email: string, phone?: string, join?: string) {
  ids[key] = randomUUID();
  tokens[`tok_${key}`] = ids[key];
  await q('insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3, now())',
    [ids[key], email, JSON.stringify({ name: key, ...(phone ? { phone } : {}), ...(join ? { join_code: join } : {}) })]);
}
const bizOf = async (key: string) => (await q('select business_id from profiles where id = $1', [ids[key]])).rows[0].business_id as string;

function call(fn: string, body: unknown, token?: string, headers: Record<string, string> = {}) {
  return handlers[fn](new Request(`https://x.supabase.co/functions/v1/${fn}`, {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: SITE, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  }));
}
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(async () => r.text()) });

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); // the functions log each refusal; expected here
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text); alter table storage.objects enable row level security;`);
  await db.exec(readFileSync('supabase/schema.sql', 'utf8'));
  await signup('owner', 'owner@a.com', '9811100001');
  const code = (await q('select join_code from businesses')).rows[0].join_code as string;
  await signup('sales', 'sales@a.com', undefined, code);
  await q(`update profiles set role = 'sales' where id = $1`, [ids.sales]);
  await signup('other', 'other@b.com', '9811100002'); // another business
  useTestDb(db, tokens);

  const env: Record<string, string> = {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET, ALLOWED_ORIGINS: SITE,
  };
  let current = '';
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: Handler) => { handlers[current] = h; },
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://api.razorpay.com/')) return realFetch(input, init);
    const auth = new Headers(init?.headers).get('Authorization') || '';
    if (auth !== 'Basic ' + btoa(`${KEY_ID}:${KEY_SECRET}`)) return new Response(JSON.stringify({ error: { description: 'auth' } }), { status: 401 });
    if (url.endsWith('/v1/orders') && init?.method === 'POST') {
      const b = JSON.parse(String(init.body));
      rz.orders.push({ amount: b.amount, auth });
      return new Response(JSON.stringify({ id: `order_TEST${String(rz.nextOrder++).padStart(8, '0')}`, amount: b.amount, currency: b.currency, status: 'created' }));
    }
    const m = /\/v1\/payments\/(pay_\w+)(\/capture)?$/.exec(url);
    if (m) {
      const p = rz.payments[m[1]];
      if (!p) return new Response(JSON.stringify({ error: { description: 'not found' } }), { status: 400 });
      if (m[2]) { rz.captures++; p.status = 'captured'; }
      return new Response(JSON.stringify(p));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  for (const fn of ['create-order', 'verify-payment', 'razorpay-webhook']) {
    current = fn;
    const path = fileURLToPath(new URL(`../../supabase/functions/${fn}/index.ts`, import.meta.url));
    await import(/* @vite-ignore */ path);
  }
}, 60000);

describe('payment server (the real functions, end to end)', () => {
  it('answers the browser\'s CORS pre-check for our website only', async () => {
    const ok = await handlers['create-order'](new Request('https://x/create-order', { method: 'OPTIONS', headers: { Origin: SITE } }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    const bad = await handlers['create-order'](new Request('https://x/create-order', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }));
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('create-order: only a signed-in admin, only a real plan, price from the database', async () => {
    expect((await json(await call('create-order', { plan: '12m' }))).status).toBe(401);
    expect((await json(await call('create-order', { plan: '12m' }, 'tok_forged'))).status).toBe(401);
    expect(await json(await call('create-order', { plan: '12m' }, 'tok_sales'))).toMatchObject({ status: 400, body: { error: expect.stringMatching(/Only the business admin/) } });
    expect(await json(await call('create-order', { plan: '99m' }, 'tok_owner'))).toMatchObject({ status: 400, body: { error: 'Unknown plan.' } });
    expect(await json(await call('create-order', { plan: "1m' or 1=1" }, 'tok_owner'))).toMatchObject({ status: 400, body: { error: 'Choose a plan.' } });
    // The browser cannot choose the amount: extra fields are ignored, the plan's price is used.
    const r = await json(await call('create-order', { plan: '12m', amount: 100 }, 'tok_owner'));
    expect(r).toMatchObject({ status: 200, body: { amount: 750000, currency: 'INR', keyId: KEY_ID, label: '12 months' } });
    expect(rz.orders.at(-1)!.amount).toBe(750000);
    const row = (await q('select business_id, amount_paise, status, created_by from subscription_payments where order_id = $1', [r.body.orderId])).rows[0];
    expect(row).toEqual({ business_id: await bizOf('owner'), amount_paise: 750000, status: 'created', created_by: ids.owner });
  });

  it('verify-payment: a forged signature, someone else\'s order, or a short payment changes nothing; a real one counts once', async () => {
    const { body: o } = await json(await call('create-order', { plan: '3m' }, 'tok_owner'));
    const payId = 'pay_GOOD0000000001';
    rz.payments[payId] = { id: payId, order_id: o.orderId, amount: 250000, currency: 'INR', status: 'captured' };
    const good = sign(`${o.orderId}|${payId}`, KEY_SECRET);
    const before = (await q('select paid_until from businesses where id = $1', [await bizOf('owner')])).rows[0].paid_until;

    expect((await json(await call('verify-payment', { orderId: o.orderId, paymentId: payId, signature: sign(`${o.orderId}|${payId}`, 'guessed') }, 'tok_owner'))).status).toBe(400);
    expect((await json(await call('verify-payment', { orderId: o.orderId, paymentId: payId, signature: good }, 'tok_other'))).status).toBe(404);
    expect((await json(await call('verify-payment', { orderId: o.orderId, paymentId: payId, signature: good }))).status).toBe(401);
    rz.payments[payId].amount = 100; // Razorpay says only ₹1 was paid
    expect((await json(await call('verify-payment', { orderId: o.orderId, paymentId: payId, signature: good }, 'tok_owner'))).status).toBe(400);
    expect((await q('select paid_until from businesses where id = $1', [await bizOf('owner')])).rows[0].paid_until).toEqual(before);

    rz.payments[payId].amount = 250000;
    const ok = await json(await call('verify-payment', { orderId: o.orderId, paymentId: payId, signature: good }, 'tok_owner'));
    expect(ok).toMatchObject({ status: 200, body: { already: false } });
    // Paid during the trial: three months after the trial ends.
    const b = (await q('select trial_ends, paid_until, plan from businesses where id = $1', [await bizOf('owner')])).rows[0];
    expect(b.plan).toBe('3m');
    expect((await q(`select $1::timestamptz = $2::timestamptz + interval '3 months' ok`, [b.paid_until, b.trial_ends])).rows[0].ok).toBe(true);
    // Reported again (or by the webhook): nothing more.
    expect(await json(await call('verify-payment', { orderId: o.orderId, paymentId: payId, signature: good }, 'tok_owner'))).toMatchObject({ status: 200, body: { already: true } });
    expect((await q('select paid_until from businesses where id = $1', [await bizOf('owner')])).rows[0].paid_until).toEqual(b.paid_until);
  });

  it('verify-payment captures a payment that is only authorised (manual-capture accounts)', async () => {
    const { body: o } = await json(await call('create-order', { plan: '1m' }, 'tok_owner'));
    const payId = 'pay_AUTH0000000001';
    rz.payments[payId] = { id: payId, order_id: o.orderId, amount: 100000, currency: 'INR', status: 'authorized' };
    const r = await json(await call('verify-payment', { orderId: o.orderId, paymentId: payId, signature: sign(`${o.orderId}|${payId}`, KEY_SECRET) }, 'tok_owner'));
    expect(r).toMatchObject({ status: 200, body: { already: false } });
    expect(rz.captures).toBe(1);
    // A second payment authorised for the same (now paid) order is not captured: nobody is charged twice.
    const second = 'pay_AUTH0000000002';
    rz.payments[second] = { id: second, order_id: o.orderId, amount: 100000, currency: 'INR', status: 'authorized' };
    const again = await json(await call('verify-payment', { orderId: o.orderId, paymentId: second, signature: sign(`${o.orderId}|${second}`, KEY_SECRET) }, 'tok_owner'));
    expect(again).toMatchObject({ status: 200, body: { already: true } });
    expect(rz.captures).toBe(1);
    expect(rz.payments[second].status).toBe('authorized');
  });

  it('webhook: only with our signature; adds the plan once even if the browser never reported it; ignores other orders', async () => {
    const { body: o } = await json(await call('create-order', { plan: '6m' }, 'tok_owner'));
    const until = (await q('select paid_until from businesses where id = $1', [await bizOf('owner')])).rows[0].paid_until as Date;
    const event = (orderId: string, payId: string, amount: number) => JSON.stringify({
      event: 'payment.captured', payload: { payment: { entity: { id: payId, order_id: orderId, amount, currency: 'INR', status: 'captured' } } } });
    const body = event(o.orderId, 'pay_HOOK0000000001', 450000);
    const hook = (raw: string, sig: string | null) => handlers['razorpay-webhook'](new Request('https://x/razorpay-webhook', {
      method: 'POST', body: raw, headers: sig ? { 'X-Razorpay-Signature': sig } : {} }));

    expect((await hook(body, null)).status).toBe(401);
    expect((await hook(body, sign(body, 'wrong'))).status).toBe(401);
    const tampered = event(o.orderId, 'pay_HOOK0000000001', 1);
    expect((await hook(tampered, sign(body, WEBHOOK_SECRET))).status).toBe(401); // body changed after signing
    expect((await q('select paid_until from businesses where id = $1', [await bizOf('owner')])).rows[0].paid_until).toEqual(until);

    const r = await hook(body, sign(body, WEBHOOK_SECRET));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('OK');
    const after = (await q('select paid_until from businesses where id = $1', [await bizOf('owner')])).rows[0].paid_until;
    expect((await q(`select $1::timestamptz = $2::timestamptz + interval '6 months' ok`, [after, until])).rows[0].ok).toBe(true);
    // Razorpay retries: still once.
    expect((await hook(body, sign(body, WEBHOOK_SECRET))).status).toBe(200);
    expect((await q('select paid_until from businesses where id = $1', [await bizOf('owner')])).rows[0].paid_until).toEqual(after);
    // A signed event with a lower amount than the order: refused, nothing added.
    const { body: o2 } = await json(await call('create-order', { plan: '1m' }, 'tok_owner'));
    const short = event(o2.orderId, 'pay_HOOK0000000002', 50000);
    expect(await (await hook(short, sign(short, WEBHOOK_SECRET))).text()).toBe('Refused');
    expect((await q('select status from subscription_payments where order_id = $1', [o2.orderId])).rows[0].status).toBe('created');
    // An order that is not one of ours (another product on the same Razorpay account).
    const foreign = event('order_NOTOURS000001', 'pay_HOOK0000000003', 100000);
    expect(await (await hook(foreign, sign(foreign, WEBHOOK_SECRET))).text()).toBe('Ignored');
  });
});
