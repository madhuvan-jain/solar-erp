// @vitest-environment node
// Runs supabase/schema.sql in a real (in-memory) Postgres with Supabase's auth/storage stubbed,
// then checks the security rules and business rules as different users.
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ENTITIES } from '../../modules/registry';
import { canDelete, canRead, canWrite, type AccessMap } from '../rbac';
import type { Role } from './types';

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
`;
const GRANTS = `
  grant usage on schema public, auth, storage to anon, authenticated;
  grant all on all tables in schema public to anon, authenticated;
  grant all on storage.objects to authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

let db: PGlite;
const ids: Record<string, string> = {};
let generatedPhone = 9000000000;

async function as<T>(who: string | null, fn: () => Promise<T>, claims: Record<string, unknown> = {}): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who ? ids[who] : ''}', false);`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: who ? ids[who] : null, ...claims })]);
  await db.exec(who ? 'set role authenticated' : 'set role anon');
  try { return await fn(); } finally { await db.exec('reset role'); }
}

const q = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);
/** Lines worth `total` (no GST), with that total stored: what the app saves for an invoice or purchase order. */
const lines = (total: number, productId?: string, qty = 1) =>
  ({ items: [{ description: 'Item', qty, rate: total / qty, gstRate: 0, ...(productId ? { productId } : {}) }], grandTotal: total });
const insert = (entity: string, data: object, id: string = randomUUID()) =>
  q('insert into records (id, entity, data) values ($1, $2, $3) returning *', [id, entity, JSON.stringify(data)]).then((r) => r.rows[0]);

// Everyone after the owner joins the owner's business with its company code, unless told to start their own.
let ownerCode = '';
let ownerBiz = '';
async function signup(key: string, email: string, confirmed = true, phone?: string, opts: { own?: boolean; code?: string; verifiedPhone?: boolean } = {}) {
  ids[key] = randomUUID();
  const mobile = phone || (!opts.own ? String(generatedPhone++) : undefined);
  const join = opts.own ? undefined : opts.code ?? (ownerCode || undefined);
  await q('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [ids[key], email, JSON.stringify({ name: key, ...(mobile ? { phone: mobile } : {}), ...(join ? { join_code: join } : {}) })]);
  if (confirmed) await q('update auth.users set email_confirmed_at = now() where id = $1', [ids[key]]);
  const digits = mobile?.replace(/\D/g, '').slice(-10);
  if (opts.verifiedPhone !== false && digits && /^[6-9]\d{9}$/.test(digits)) {
    await q('update auth.users set phone = $2, phone_confirmed_at = now() where id = $1', [ids[key], '+91' + digits]);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const sql = readFileSync('supabase/schema.sql', 'utf8');
  await db.exec(sql);
  await db.exec(sql); // must be safe to re-run
  await db.exec(GRANTS);
  await signup('owner', 'Owner@Biz.com', true, '9555500001');
  const biz = (await q('select b.id, b.join_code from businesses b join profiles p on p.business_id = b.id where p.id = $1', [ids.owner])).rows[0];
  ownerCode = biz.join_code as string;
  ownerBiz = biz.id as string;
  await signup('intruder', 'first-but-not-owner@x.com');
  await signup('sales', 'sales@biz.com');
  await signup('tech', 'tech@biz.com');
  await signup('accounts', 'acc@biz.com');
  await q(`update profiles set role = 'sales' where id = $1`, [ids.sales]);
  await q(`update profiles set role = 'technician' where id = $1`, [ids.tech]);
  await q(`update profiles set role = 'accounts' where id = $1`, [ids.accounts]);
}, 60000);

describe('database rules', () => {
  it('does not expose a business to accounts until both email and mobile are verified', async () => {
    await signup('email-unverified', 'email-unverified@biz.com', false, '9000000999');
    await signup('phone-unverified', 'phone-unverified@biz.com', true, '9000000998', { verifiedPhone: false });
    for (const who of ['email-unverified', 'phone-unverified']) {
      const { rows } = await as(who, () => q('select public.my_role() as role, public.my_business() as business'));
      expect(rows[0]).toEqual({ role: null, business: null });
      expect((await as(who, () => q('select * from records'))).rows).toHaveLength(0);
    }
    expect((await as('owner', () => q('select public.my_business() as business'))).rows[0].business).toBe(ownerBiz);
  });

  it('signing up without a company code starts a business (admin, 15-day trial); with the code, people wait for approval', async () => {
    const r = await q('select email, role, business_id from profiles order by email');
    const role = Object.fromEntries(r.rows.map((x) => [x.email, x.role]));
    expect(role['Owner@Biz.com']).toBe('admin');
    expect(role['first-but-not-owner@x.com']).toBe('pending');
    expect(new Set(r.rows.filter((x) => x.email !== 'other@else.com').map((x) => x.business_id)).size).toBe(1);
    const b = (await q('select trial_ends - created_at as t, paid_until from businesses where owner_id = $1', [ids.owner])).rows[0];
    expect(String(b.t)).toMatch(/15 days/);
    expect(b.paid_until).toBeNull();
    await expect(signup('lost', 'lost@x.com', true, undefined, { code: 'NOPE1234' })).rejects.toThrow(/No business has this company code/);
  });

  it('pending users and anonymous visitors can read and write nothing', async () => {
    await as('owner', () => insert('leads', { name: 'Secret', phone: '9000000001' }));
    for (const who of ['intruder', null]) {
      const rows = await as(who, () => q('select * from records'));
      expect(rows.rows).toHaveLength(0);
      await expect(as(who, () => insert('leads', { name: 'x' }))).rejects.toThrow();
    }
    await expect(as(null, () => q('select * from counters'))).resolves.toHaveProperty('rows', []);
  });

  it('users cannot promote themselves; admins cannot remove the last admin', async () => {
    const r = await as('sales', () => q(`update profiles set role = 'admin' where id = $1 returning id`, [ids.sales]));
    expect(r.rows).toHaveLength(0);
    await expect(as('owner', () => q(`update profiles set role = 'sales' where id = $1`, [ids.owner]))).rejects.toThrow(/one active admin/);
    await expect(as('owner', () => q(`update profiles set active = false where id = $1`, [ids.owner]))).rejects.toThrow(/one active admin/);
  });

  it('enforces module access per role in the database', async () => {
    const inv = await as('accounts', () => insert('invoices', { status: 'Sent', date: '2026-11-12', ...lines(1000), _numKey: 'invoices:26-27', _numPrefix: 'INV/26-27/' }));
    expect(inv.data).toMatchObject({ number: 'INV/26-27/0001' });
    expect((await as('tech', () => q(`select * from records where entity = 'invoices'`))).rows).toHaveLength(0);
    expect((await as('sales', () => q(`select * from records where entity = 'invoices'`))).rows).toHaveLength(0);
    await expect(as('tech', () => insert('invoices', { status: 'Sent', ...lines(10) }))).rejects.toThrow(/row-level security/);
    // technician can read leads (crm: read) but not edit them
    const lead = await as('sales', () => insert('leads', { name: 'L', phone: '9000000002' }));
    expect((await as('tech', () => q('select * from records where id = $1', [lead.id]))).rows).toHaveLength(1);
    const upd = await as('tech', () => q(`update records set data = data || '{"name":"hacked"}' where id = $1 returning id`, [lead.id]));
    expect(upd.rows).toHaveLength(0);
    // only admin writes settings
    await expect(as('sales', () => insert('_settings', { companyName: 'X' }))).rejects.toThrow();
    await as('owner', () => insert('_settings', { companyName: 'Biz' }));
    expect((await as('tech', () => q(`select * from records where entity = '_settings'`))).rows).toHaveLength(1);
    await expect(as('owner', () => insert('bogusEntity', {}))).rejects.toThrow(/row-level security|Unknown record type/);
  });

  it('numbers are sequential, permanent, cannot be spoofed and do not gap on failure', async () => {
    const a = await as('sales', () => insert('quotations', { number: 'FAKE-1', _numKey: 'quotations:26-27', _numPrefix: 'QT/26-27/' }));
    expect(a.data).toMatchObject({ number: 'QT/26-27/0001', _seq: 1 });
    await expect(as('sales', () => insert('quotations', { _numKey: 'quotations:26-27', _numPrefix: 'QT/26-27/' }, a.id as string))).rejects.toThrow();
    const b = await as('sales', () => insert('quotations', { _numKey: 'quotations:26-27', _numPrefix: 'QT/26-27/' }));
    expect(b.data).toMatchObject({ number: 'QT/26-27/0002' }); // failed insert above did not consume a number
    const u = await as('sales', () => q(`update records set data = data || '{"number":"EDITED","_seq":99}' where id = $1 returning *`, [a.id]));
    expect(u.rows[0].data).toMatchObject({ number: 'QT/26-27/0001', _seq: 1 });
    expect(u.rows[0].version).toBe(2);
  });

  it('a record cannot advance another type\'s counter (no burning invoice numbers)', async () => {
    await expect(as('sales', () => insert('leads', { name: 'x', _numKey: 'invoices:26-27', _numPrefix: 'INV/26-27/' }))).rejects.toThrow(/Invalid numbering/);
    await expect(as('sales', () => insert('leads', { name: 'x', _numKey: 'leads', _numPrefix: '<b>' }))).rejects.toThrow(/Invalid numbering/);
  });

  it('payments on invoices without a stored total (older versions) are checked against their lines', async () => {
    const id = randomUUID();
    await as('owner', () => q('select restore_records($1::jsonb)', [JSON.stringify([{ id, entity: 'invoices', data: { status: 'Sent', items: lines(100).items } }])]));
    await as('accounts', () => insert('payments', { invoiceId: id, amount: 50 }));
    await expect(as('accounts', () => insert('payments', { invoiceId: id, amount: 51 }))).rejects.toThrow(/balance due \(50/);
  });

  it('optimistic concurrency: a stale version updates nothing', async () => {
    const r = await as('sales', () => insert('leads', { name: 'V', phone: '9000000003' }));
    const ok = await as('sales', () => q(`update records set data = data || '{"city":"A"}' where id = $1 and version = 1 returning version`, [r.id]));
    expect(ok.rows[0].version).toBe(2);
    const stale = await as('sales', () => q(`update records set data = data || '{"city":"B"}' where id = $1 and version = 1 returning version`, [r.id]));
    expect(stale.rows).toHaveLength(0);
  });

  it('stock cannot go negative — on dispatch, on edit and on delete', async () => {
    const p = await as('accounts', () => insert('products', { name: 'Panel', sku: 'P1' }));
    const pid = p.id as string;
    // Stock typed in by hand needs an inventory manager (the admin is one); documents' own entries do not.
    await expect(as('accounts', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 10 }))).rejects.toThrow(/inventory manager/);
    const inMove = await as('owner', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 10, reason: 'Opening stock' }));
    const po = await as('accounts', () => insert('purchaseOrders', { status: 'Ordered', date: '2026-11-12', ...lines(100, pid) }));
    const dc = await as('accounts', () => insert('dispatches', { status: 'Dispatched', date: '2026-11-12', items: [{ productId: pid, description: 'Panel', qty: 6, rate: 0, gstRate: 0 }] }));
    const out = await as('accounts', () => insert('stockMoves', { productId: pid, direction: 'Out', qty: 6, sourceType: 'dispatches', sourceId: dc.id }));
    await expect(as('owner', () => insert('stockMoves', { productId: pid, direction: 'Out', qty: 5 }))).rejects.toThrow(/Only 4 in stock/);
    await expect(as('owner', () => q(`update records set data = data || '{"qty":2}' where id = $1`, [inMove.id]))).rejects.toThrow(/negative/);
    await expect(as('owner', () => q('delete from records where id = $1', [inMove.id]))).rejects.toThrow(/negative|other records/);
    await expect(as('owner', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 'abc' }))).rejects.toThrow(/more than 0/);
    // A document's own entries are never edited or deleted on their own, and the document is kept.
    await expect(as('owner', () => q(`update records set data = data || '{"qty":1}' where id = $1`, [out.id]))).rejects.toThrow(/Change it there/);
    await q(`update profiles set access = '{"inventory": "manager"}' where id = $1`, [ids.accounts]);
    await expect(as('accounts', () => q('delete from records where id = $1', [out.id]))).rejects.toThrow(/cannot be deleted on its own/);
    await q(`update profiles set access = '{}' where id = $1`, [ids.accounts]);
    await expect(as('owner', () => q('delete from records where id = $1', [dc.id]))).rejects.toThrow(/kept for the record/);
    // No made-up stock: an entry must belong to a real document, or be the matching half of a transfer.
    await expect(as('accounts', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 500, sourceType: 'purchaseOrders', sourceId: randomUUID() }))).rejects.toThrow(/live purchase order/);
    await expect(as('accounts', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 500, sourceType: 'whatever', sourceId: 'x' }))).rejects.toThrow(/Unknown source/);
    await expect(as('accounts', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 500, sourceType: 'transfer', sourceId: 't1' }))).rejects.toThrow(/take out what it puts in/);
    await as('accounts', () => insert('stockMoves', { productId: pid, direction: 'Out', qty: 2, sourceType: 'transfer', sourceId: 't2' }));
    await as('accounts', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 2, sourceType: 'transfer', sourceId: 't2' }));
    await expect(as('accounts', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 2, sourceType: 'transfer', sourceId: 't2' }))).rejects.toThrow(/take out what it puts in/);
    await as('accounts', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 1, sourceType: 'purchaseOrders', sourceId: po.id }));
    // The admin can remove a document's entry that should not be there.
    expect((await as('owner', () => q('delete from records where id = $1 returning id', [out.id]))).rows).toHaveLength(1);
  });

  it('payments cannot exceed the invoice, invoices cannot shrink below payments or be cancelled/deleted', async () => {
    const inv = await as('accounts', () => insert('invoices', { status: 'Sent', date: '2026-11-12', ...lines(1000) }));
    const iid = inv.id as string;
    await as('accounts', () => insert('payments', { invoiceId: iid, amount: 600 }));
    await expect(as('accounts', () => insert('payments', { invoiceId: iid, amount: 401 }))).rejects.toThrow(/balance due \(400/);
    await as('accounts', () => insert('payments', { invoiceId: iid, amount: 400 }));
    await expect(as('accounts', () => q(`update records set data = data || '{"grandTotal":500}' where id = $1`, [iid]))).rejects.toThrow(/does not match the lines|cannot be less/);
    await expect(as('accounts', () => q(`update records set data = data || '{"status":"Cancelled"}' where id = $1`, [iid]))).rejects.toThrow(/Delete the payments/);
    await expect(as('owner', () => q('delete from records where id = $1', [iid]))).rejects.toThrow(/cannot be deleted/);
    await expect(as('accounts', () => insert('payments', { invoiceId: randomUUID(), amount: 1 }))).rejects.toThrow(/does not exist/);
  });

  it('blocks deleting records that others reference, and only admin/manager can delete', async () => {
    const c = await as('sales', () => insert('customers', { name: 'C', phone: '9000000004' }));
    await as('sales', () => insert('quotations', { customerId: c.id }));
    await expect(as('owner', () => q('delete from records where id = $1', [c.id]))).rejects.toThrow(/other records still use/);
    const lone = await as('sales', () => insert('leads', { name: 'Del', phone: '9000000005' }));
    const r = await as('sales', () => q('delete from records where id = $1 returning id', [lone.id]));
    expect(r.rows).toHaveLength(0);
    const r2 = await as('owner', () => q('delete from records where id = $1 returning id', [lone.id]));
    expect(r2.rows).toHaveLength(1);
  });

  it('web enquiry: anonymous, validated, de-duplicated, numbered', async () => {
    await as(null, () => q(`select web_enquiry('Visitor', '98765 43210', '', 'Patna', 'hi', '', '${ownerBiz}'::uuid)`));
    await as(null, () => q(`select web_enquiry('Visitor again', '+91 9876543210', '', '', '', '', '${ownerBiz}'::uuid)`));
    await expect(as(null, () => q(`select web_enquiry('', '9876543210', '', '', '', '', '${ownerBiz}'::uuid)`))).rejects.toThrow(/name/);
    await expect(as(null, () => q(`select web_enquiry('X', '12', '', '', '', '', '${ownerBiz}'::uuid)`))).rejects.toThrow(/mobile/);
    await expect(as(null, () => q(`select web_enquiry('X', null, '', '', '', '', '${ownerBiz}'::uuid)`))).rejects.toThrow(/mobile/);
    await expect(as(null, () => q(`select web_enquiry('X', '9123456789', 'not-an-email', '', '', '', '${ownerBiz}'::uuid)`))).rejects.toThrow(/email/);
    for (let i = 0; i < 3; i++) await as(null, () => q(`select web_enquiry('Spam', '91000000${10 + i}', '', '', '', '', '${ownerBiz}'::uuid)`));
    await expect(as(null, () => q(`select web_enquiry('Spam', '9100000099', '', '', '', '', '${ownerBiz}'::uuid)`))).rejects.toThrow(/Too many/);
    const leads = await as('owner', () => q(`select data from records where entity = 'leads' and data->>'source' = 'Website'`));
    expect(leads.rows.filter((r) => (r.data as { name: string }).name.startsWith('Visitor'))).toHaveLength(1);
    expect(leads.rows[0].data).toMatchObject({ status: 'New', number: expect.stringMatching(/^LD-\d{4}$/) });
    await expect(as(null, () => q(`select restore_records('[]'::jsonb)`))).rejects.toThrow();
  });

  it('restore is admin-only, keeps numbers and moves counters past them', async () => {
    const rows = [{ id: randomUUID(), entity: 'invoices', data: { number: 'INV/27-28/0042', _numKey: 'invoices:27-28', _seq: 42, status: 'Sent', grandTotal: 5 } }];
    await expect(as('accounts', () => q('select restore_records($1::jsonb)', [JSON.stringify(rows)]))).rejects.toThrow(/Only an admin/);
    await as('owner', () => q('select restore_records($1::jsonb)', [JSON.stringify(rows)]));
    const next = await as('accounts', () => insert('invoices', { status: 'Sent', date: '2027-05-01', ...lines(1), _numKey: 'invoices:27-28', _numPrefix: 'INV/27-28/' }));
    expect(next.data).toMatchObject({ number: 'INV/27-28/0043' });
  });

  it('files: own folder on upload; seen only with a record the person may see; deleted by uploader-manager or admin', async () => {
    await expect(as('intruder', () => q(`insert into storage.objects (bucket_id, name) values ('files', $1)`, [`${ids.intruder}/a.pdf`]))).rejects.toThrow();
    await expect(as('tech', () => q(`insert into storage.objects (bucket_id, name) values ('files', 'b.pdf')`))).rejects.toThrow(); // not in own folder
    await as('tech', () => q(`insert into storage.objects (bucket_id, name) values ('files', $1)`, [`${ids.tech}/b.pdf`]));
    const sees = (who: string, name: string) => as(who, () => q(`select name from storage.objects where name = $1`, [name])).then((r) => r.rows.length);
    expect(await sees('tech', `${ids.tech}/b.pdf`)).toBe(1); // own upload
    // A KYC copy filed on a document: visible to those who may see documents, not to someone with documents = none.
    await as('owner', () => q(`insert into storage.objects (bucket_id, name) values ('files', $1)`, [`${ids.owner}/kyc.pdf`]));
    await as('owner', () => insert('documents', { name: 'Aadhaar', file: { name: 'kyc.pdf', path: `${ids.owner}/kyc.pdf` } }));
    await as('owner', () => q(`insert into storage.objects (bucket_id, name) values ('files', $1)`, [`${ids.owner}/loose.pdf`]));
    expect(await sees('sales', `${ids.owner}/kyc.pdf`)).toBe(1);
    expect(await sees('sales', `${ids.owner}/loose.pdf`)).toBe(0); // no record uses it
    await q(`update profiles set access = '{"documents": "none"}' where id = $1`, [ids.tech]);
    expect(await sees('tech', `${ids.owner}/kyc.pdf`)).toBe(0);
    await q(`update profiles set access = '{}' where id = $1`, [ids.tech]);
    // Never deleted through someone else: only the admin, or a manager in their own folder.
    expect((await as('tech', () => q(`delete from storage.objects where name = $1 returning id`, [`${ids.tech}/b.pdf`]))).rows).toHaveLength(0);
    expect((await as('owner', () => q(`delete from storage.objects where name = $1 returning id`, [`${ids.tech}/b.pdf`]))).rows).toHaveLength(1);
  });

  it('the change history is kept in cloud mode, and accounts that moved stock can still be deleted', async () => {
    const lead = await as('sales', () => insert('leads', { name: 'History', phone: '9000004001' }));
    await as('sales', () => insert('activity', { on: 'leads', recordId: lead.id, kind: 'note', text: 'Called' }));
    expect((await as('sales', () => q(`select id from records where entity = 'activity' and data->>'recordId' = $1`, [lead.id]))).rows).toHaveLength(1);
    // A person who received goods (a stock entry made by a purchase order) deletes their account.
    await signup('leaver', 'leaver@biz.com');
    await q(`update profiles set role = 'accounts' where id = $1`, [ids.leaver]);
    const p = await as('owner', () => insert('products', { name: 'Cable', sku: 'C1' }));
    const po = await as('leaver', () => insert('purchaseOrders', { status: 'Ordered', date: '2026-11-12', ...lines(300, p.id as string, 3) }));
    await as('leaver', () => insert('stockMoves', { productId: p.id, direction: 'In', qty: 3, sourceType: 'purchaseOrders', sourceId: po.id }));
    await as('leaver', () => q('select delete_my_account()'));
    expect((await q(`select count(*)::int as n from auth.users where id = $1`, [ids.leaver])).rows[0].n).toBe(0);
  });

  it('an unconfirmed sign-up cannot hold someone else\'s mobile number for more than a day', async () => {
    await signup('holder', 'holder@x.com', false, '9000007001');
    await expect(signup('realperson', 'real@biz.com', true, '9000007001')).rejects.toThrow(/already used/);
    await q(`update auth.users set created_at = now() - interval '2 days' where id = $1`, [ids.holder]);
    await signup('realperson', 'real@biz.com', true, '9000007001');
    expect((await q(`select id from user_phones where phone = '+919000007001'`)).rows.map((r) => r.id)).toEqual([ids.realperson]);
  });

  it('web enquiries: a bot that fills the hidden field is ignored; the limit uses the real visitor address', async () => {
    const before = (await q(`select count(*)::int as n from records where entity = 'leads'`)).rows[0].n as number;
    await as(null, () => q(`select web_enquiry('Bot', '9000005001', '', '', '', 'http://spam.example', '${ownerBiz}'::uuid)`));
    expect((await q(`select count(*)::int as n from records where entity = 'leads'`)).rows[0].n).toBe(before);
    // Same visitor, different made-up X-Forwarded-For prefixes: still counted as one visitor.
    for (let i = 0; i < 5; i++) {
      await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` })]);
      await as(null, () => q(`select web_enquiry('Visitor ' || $1, $2, '', '', '', '', '${ownerBiz}'::uuid)`, [String(i), `90000060${10 + i}`]));
    }
    await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': '10.9.9.9, 203.0.113.7' })]);
    await expect(as(null, () => q(`select web_enquiry('Visitor 6', '9000006099', '', '', '', '', '${ownerBiz}'::uuid)`))).rejects.toThrow(/Too many enquiries from this connection/);
    await db.query(`select set_config('request.headers', '{}', false)`);
  });

  it('database permissions match the app permission table for every role and record type', async () => {
    const roles: Role[] = ['manager', 'sales', 'technician', 'accounts'];
    const mismatches: string[] = [];
    for (const role of roles) {
      await q(`update profiles set role = $1 where id = $2`, [role, ids.intruder]);
      for (const e of ENTITIES) {
        const r = await as('intruder', () => q('select can_access($1, false) as r, can_access($1, true) as w', [e.key]));
        const { r: dbRead, w: dbWrite } = r.rows[0] as { r: boolean; w: boolean };
        if (dbRead !== canRead(role, e.module)) mismatches.push(`${role} read ${e.key}: db=${dbRead}`);
        if (dbWrite !== canWrite(role, e.module)) mismatches.push(`${role} write ${e.key}: db=${dbWrite}`);
      }
    }
    await q(`update profiles set role = 'pending' where id = $1`, [ids.intruder]);
    expect(mismatches).toEqual([]);
  });
  it('account deletion: users delete themselves, admins delete others, the last admin is protected', async () => {
    await signup('leaver', 'leaver@biz.com');
    await signup('temp', 'temp@biz.com');
    await q(`update profiles set role = 'sales' where id in ($1, $2)`, [ids.leaver, ids.temp]);
    const lead = await as('leaver', () => insert('leads', { name: 'Kept lead', phone: '9000000777' }));
    await as('leaver', () => q('select delete_my_account()'));
    expect((await q('select * from profiles where id = $1', [ids.leaver])).rows).toHaveLength(0);
    const kept = (await q('select created_by from records where id = $1', [lead.id])).rows[0];
    expect(kept).toBeTruthy();
    expect(kept.created_by).toBeNull(); // the business record stays, unlinked from the deleted person
    await expect(as('owner', () => q('select delete_my_account()'))).rejects.toThrow(/only admin/);
    await expect(as('sales', () => q('select admin_delete_user($1)', [ids.temp]))).rejects.toThrow(/Only an admin/);
    await expect(as('owner', () => q('select admin_delete_user($1)', [ids.owner]))).rejects.toThrow(/Delete my account/);
    await expect(as(null, () => q('select delete_my_account()'))).rejects.toThrow();
    await as('owner', () => q('select admin_delete_user($1)', [ids.temp]));
    expect((await q('select * from auth.users where id = $1', [ids.temp])).rows).toHaveLength(0);
  });

  it('the enquiry rate limit keeps only a hash of the visitor address', async () => {
    const rows = (await q('select ip from enquiry_log')).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(String(r.ip)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('mobile numbers: saved at sign-up, one per account, readable only by the person and the admin', async () => {
    await signup('mob1', 'mob1@biz.com', true, '+91 98765 43210');
    await signup('mob2', 'mob2@biz.com', true, '098765-11111');
    await q(`update profiles set role = 'sales' where id in ($1, $2)`, [ids.mob1, ids.mob2]);
    expect((await q('select phone from user_phones where id = $1', [ids.mob1])).rows[0].phone).toBe('+919876543210');
    expect((await q('select phone from user_phones where id = $1', [ids.mob2])).rows[0].phone).toBe('+919876511111');
    // Another account cannot take a number that is already used: the whole sign-up fails.
    await expect(signup('mobdup', 'dup@biz.com', true, '9876543210')).rejects.toThrow(/already used/);
    expect((await q('select * from auth.users where email = $1', ['dup@biz.com'])).rows).toHaveLength(0);
    // Not a mobile number: nothing stored (the app refuses it before sign-up).
    await signup('mobbad', 'bad@biz.com', true, '12345');
    expect((await q('select * from user_phones where id = $1', [ids.mobbad])).rows).toHaveLength(0);

    const seen = (who: string) => as(who, () => q('select id from user_phones')).then((r) => r.rows.map((x) => x.id));
    expect(await seen('mob1')).toEqual([ids.mob1]);
    expect(await seen('owner')).toEqual(expect.arrayContaining([ids.mob1, ids.mob2]));
    expect(await as(null, () => q('select id from user_phones').then((r) => r.rows, () => []))).toEqual([]);
    // No direct writes, not even to your own row.
    await expect(as('mob1', () => q(`update user_phones set phone = '+919999988888' where id = $1`, [ids.mob1]).then((r) => r.affectedRows))).resolves.toBe(0);
    await expect(as('mob1', () => q(`insert into user_phones (id, phone) values ($1, '+919999988888')`, [ids.sales]))).rejects.toThrow();
  });

  it('set_user_phone: own number or admin only, valid, unique, and the SMS-confirmed one when codes are on', async () => {
    // Changing your own existing number needs a code from your email in the last 15 minutes.
    await expect(as('mob1', () => q('select set_user_phone($1, $2)', [ids.mob1, '7000012345']))).rejects.toThrow(/code we emailed/);
    const stale = { amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) - 3600 }] };
    await expect(as('mob1', () => q('select set_user_phone($1, $2)', [ids.mob1, '7000012345']), stale)).rejects.toThrow(/code we emailed/);
    const fresh = { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }, { method: 'otp', timestamp: Math.floor(Date.now() / 1000) - 60 }] };
    await q(`update auth.users set phone = '917000012345', phone_confirmed_at = now() where id = $1`, [ids.mob1]);
    await as('mob1', () => q('select set_user_phone($1, $2)', [ids.mob1, '7000012345']), fresh);
    expect((await q('select phone from user_phones where id = $1', [ids.mob1])).rows[0].phone).toBe('+917000012345');
    await as('mob1', () => q('select set_user_phone($1, $2)', [ids.mob1, '+91 70000 12345'])); // same number again: no code needed
    await expect(as('mob1', () => q('select set_user_phone($1, $2)', [ids.mob2, '7000099999']))).rejects.toThrow(/Only an admin/);
    await expect(as('mob1', () => q('select set_user_phone($1, $2)', [ids.mob1, '5000012345']), fresh)).rejects.toThrow(/valid 10-digit/);
    await expect(as('mob1', () => q('select set_user_phone($1, $2)', [ids.mob1, '+91 98765 11111']), fresh)).rejects.toThrow(/already used/);
    await expect(as(null, () => q('select set_user_phone($1, $2)', [ids.mob1, '7000012345']))).rejects.toThrow();
    await as('owner', () => q('select set_user_phone($1, $2)', [ids.sales, '8000012345']));
    expect((await q('select phone from user_phones where id = $1', [ids.sales])).rows[0].phone).toBe('+918000012345');
    // With SMS codes on, Supabase keeps the confirmed number on the login; a different one is refused.
    await q(`update auth.users set phone = '917000012345', phone_confirmed_at = now() where id = $1`, [ids.mob1]);
    await expect(as('mob1', () => q('select set_user_phone($1, $2)', [ids.mob1, '7000054321']), fresh)).rejects.toThrow(/SMS code first/);
    await as('mob1', () => q('select set_user_phone($1, $2)', [ids.mob1, '+917000012345']));
    // Deleting the account removes the number with it.
    await as('owner', () => q('select admin_delete_user($1)', [ids.mob2]));
    expect((await q('select * from user_phones where id = $1', [ids.mob2])).rows).toHaveLength(0);
  });

  it('per-person access rights: the database follows the same levels as the app, for every app', async () => {
    await signup('custom', 'custom@biz.com');
    const combos: { role: Role; access: AccessMap }[] = [
      { role: 'sales', access: { finance: 'read', crm: 'own', inventory: 'none' } },
      { role: 'technician', access: { service: 'manager', staff: 'all', finance: 'own' } }, // "own" is not offered for finance: preset applies
      { role: 'accounts', access: { crm: 'manager', documents: 'none', sales: 'read' } },
      { role: 'manager', access: { staff: 'none', finance: 'read' } },
    ];
    const mismatches: string[] = [];
    for (const who of combos) {
      await q(`update profiles set role = $1, access = $2 where id = $3`, [who.role, JSON.stringify(who.access), ids.custom]);
      for (const e of ENTITIES) {
        const r = (await as('custom', () => q('select can_access($1, false) as r, can_access($1, true) as w', [e.key]))).rows[0] as { r: boolean; w: boolean };
        if (r.r !== canRead(who, e.module)) mismatches.push(`${who.role}+${JSON.stringify(who.access)} read ${e.key}: db=${r.r}`);
        if (r.w !== canWrite(who, e.module)) mismatches.push(`${who.role}+${JSON.stringify(who.access)} write ${e.key}: db=${r.w}`);
      }
    }
    expect(mismatches).toEqual([]);
    // The admin always has everything: any access map on an admin is dropped.
    await q(`update profiles set role = 'admin', access = '{"crm":"none"}' where id = $1`, [ids.custom]);
    expect((await q('select access from profiles where id = $1', [ids.custom])).rows[0].access).toEqual({});
    await q(`update profiles set role = 'pending', access = '{}' where id = $1`, [ids.custom]);
  });

  it('"own documents only": see and change only what you created or what names you; delete needs manager level', async () => {
    await signup('rep1', 'rep1@biz.com');
    await signup('rep2', 'rep2@biz.com');
    await q(`update profiles set role = 'sales', access = '{"crm": "own"}' where id in ($1, $2)`, [ids.rep1, ids.rep2]);
    const mine = await as('rep1', () => insert('leads', { name: 'Rep1 lead', phone: '9000001001' }));
    const theirs = await as('rep2', () => insert('leads', { name: 'Rep2 lead', phone: '9000001002' }));
    const assigned = await as('owner', () => insert('leads', { name: 'Given to rep1', phone: '9000001003', assignedTo: ids.rep1 }));
    const seen = (await as('rep1', () => q(`select id from records where entity = 'leads'`))).rows.map((r) => r.id);
    expect(seen).toEqual(expect.arrayContaining([(mine.id as string), (assigned.id as string)]));
    expect(seen).not.toContain((theirs.id as string));
    // Changing someone else's lead does nothing; their own and assigned ones can be changed.
    const upd = (id: string) => as('rep1', () => q(`update records set data = data || '{"notes":"x"}' where id = $1 returning id`, [id])).then((r) => r.rows.length);
    expect(await upd((theirs.id as string))).toBe(0);
    expect(await upd((mine.id as string))).toBe(1);
    expect(await upd((assigned.id as string))).toBe(1);
    // Other apps keep the preset: Sales is "all documents" for this role.
    const q2 = await as('owner', () => insert('quotations', { customerId: 'x', date: '2026-11-01', items: [] }));
    expect((await as('rep1', () => q(`select id from records where id = $1`, [(q2.id as string)]))).rows).toHaveLength(1);
    // Deleting needs manager level in that app.
    const del = (who: string, id: string) => as(who, () => q(`delete from records where id = $1 returning id`, [id])).then((r) => r.rows.length);
    expect(await del('rep1', (mine.id as string))).toBe(0);
    await q(`update profiles set access = '{"crm": "manager"}' where id = $1`, [ids.rep1]);
    expect(canDelete({ role: 'sales', access: { crm: 'manager' } }, 'crm')).toBe(true);
    expect(await del('rep1', (theirs.id as string))).toBe(1);
    // Taking an app away hides it completely.
    await q(`update profiles set access = '{"crm": "none"}' where id = $1`, [ids.rep1]);
    expect((await as('rep1', () => q(`select id from records where entity = 'leads'`))).rows).toHaveLength(0);
    // Nobody but the admin may change access rights.
    const self = await as('rep1', () => q(`update profiles set access = '{"crm": "manager"}' where id = $1 returning id`, [ids.rep1]));
    expect(self.rows).toHaveLength(0);
  });

  it('installing a new version (re-running schema.sql) keeps every record, user, number and access right', async () => {
    const snap = async () => ({
      records: (await q(`select id, entity, data::text, version from records order by id`)).rows,
      profiles: (await q(`select id, role, access::text, active from profiles order by id`)).rows,
      counters: (await q(`select entity, value from counters order by entity`)).rows,
      phones: (await q(`select id, phone from user_phones order by id`)).rows,
    });
    await as('owner', () => insert('leads', { name: 'Before update', phone: '9000002001' }));
    const before = await snap();
    expect(before.records.length).toBeGreaterThan(0);
    const sql = readFileSync('supabase/schema.sql', 'utf8');
    await db.exec(sql);
    expect(await snap()).toEqual(before);
  });

  it('an invoice saved as a draft gets its number from the database only when it is issued', async () => {
    const draft = await as('accounts', () => insert('invoices', { status: 'Draft', date: '2026-11-12', ...lines(10) }));
    expect(draft.data).not.toHaveProperty('number');
    const issue = (id: string, prefix: string) => as('accounts', () => q(
      `update records set data = data || jsonb_build_object('status', 'Sent', '_numKey', 'invoices:26-27', '_numPrefix', $2::text) where id = $1 returning data`, [id, prefix]));
    await expect(issue(draft.id as string, 'EVIL<script>')).rejects.toThrow(/Invalid numbering/);
    const r = await issue(draft.id as string, 'INV/26-27/');
    const n = (r.rows[0].data as Record<string, unknown>).number as string;
    expect(n).toMatch(/^INV\/26-27\/\d{4}$/);
    // Once numbered, the number never changes.
    const again = await issue(draft.id as string, 'INV/26-27/');
    expect((again.rows[0].data as Record<string, unknown>).number).toBe(n);
  });

  it('supplier payments belong to the Purchase app and to a real, open purchase order', async () => {
    const po = await as('accounts', () => insert('purchaseOrders', { status: 'Ordered', date: '2026-11-12', ...lines(150) }));
    await as('accounts', () => insert('supplierPayments', { purchaseOrderId: po.id, amount: 100 }));
    await expect(as('accounts', () => insert('supplierPayments', { purchaseOrderId: po.id, amount: 51 }))).rejects.toThrow(/still to pay on this order \(50/);
    await expect(as('accounts', () => insert('supplierPayments', { purchaseOrderId: randomUUID(), amount: 100 }))).rejects.toThrow(/does not exist/);
    await expect(as('accounts', () => insert('supplierPayments', { amount: 0 }))).rejects.toThrow(/more than 0/);
    // Sales has no Purchase access: cannot see them.
    expect((await as('sales', () => q(`select id from records where entity = 'supplierPayments'`))).rows).toHaveLength(0);
    // An order with payments is kept for the record.
    await expect(as('owner', () => q('delete from records where id = $1', [po.id]))).rejects.toThrow(/other records still use this one/);
  });

  it('third review: no NaN/Infinity tricks, no forged totals, stock only within its documents and warehouses', async () => {
    const p = await as('owner', () => insert('products', { name: 'Inverter', sku: 'R3' }));
    const pid = p.id as string;
    const wa = randomUUID(), wb = randomUUID();
    // "NaN" / "Infinity" are not numbers.
    await expect(as('owner', () => insert('stockMoves', { productId: pid, direction: 'Out', qty: 'NaN', sourceType: 'transfer', sourceId: 'x' }))).rejects.toThrow(/more than 0/);
    await expect(as('accounts', () => insert('invoices', { status: 'Draft', ...lines(100), grandTotal: 'Infinity' }))).rejects.toThrow(/does not match the lines/);
    // A total that is not what the lines give is refused (it is what payments are checked against).
    await expect(as('accounts', () => insert('invoices', { status: 'Draft', ...lines(100), grandTotal: 100000 }))).rejects.toThrow(/does not match the lines/);
    const inv = await as('accounts', () => insert('invoices', { status: 'Draft', ...lines(1000) }));
    await expect(as('accounts', () => q(`update records set data = data - 'grandTotal' where id = $1`, [inv.id]))).rejects.toThrow(/does not match the lines/);
    // Hand entries: an inventory manager adds them — and only a manager changes them.
    const opening = await as('owner', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 10, warehouseId: wa, reason: 'Opening stock' }));
    await expect(as('accounts', () => q(`update records set data = data || '{"qty": 99999}' where id = $1`, [opening.id]))).rejects.toThrow(/inventory manager/);
    // Goods received only on a live order, never more than ordered; returns never more than went out.
    const po = await as('accounts', () => insert('purchaseOrders', { status: 'Ordered', date: '2026-11-12', ...lines(500, pid, 5) }));
    await expect(as('accounts', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 6, warehouseId: wa, sourceType: 'purchaseOrders', sourceId: po.id }))).rejects.toThrow(/More than was ordered/);
    await as('accounts', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 5, warehouseId: wa, sourceType: 'purchaseOrders', sourceId: po.id }));
    const cancelled = await as('accounts', () => insert('purchaseOrders', { status: 'Cancelled', date: '2026-11-12', ...lines(500, pid, 5) }));
    await expect(as('accounts', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 1, sourceType: 'purchaseOrders', sourceId: cancelled.id }))).rejects.toThrow(/live purchase order/);
    const dc = await as('accounts', () => insert('dispatches', { status: 'Dispatched', date: '2026-11-12', items: [{ productId: pid, description: 'Inverter', qty: 2, rate: 0, gstRate: 0 }] }));
    await expect(as('accounts', () => insert('stockMoves', { productId: pid, direction: 'In', qty: 1, sourceType: 'dispatches', sourceId: dc.id }))).rejects.toThrow(/More is coming back/);
    await expect(as('accounts', () => insert('stockMoves', { productId: pid, direction: 'Out', qty: 3, warehouseId: wa, sourceType: 'dispatches', sourceId: dc.id }))).rejects.toThrow(/More is going out/);
    // Per warehouse: B has nothing, so nothing leaves B (even though A has 15).
    await expect(as('accounts', () => insert('stockMoves', { productId: pid, direction: 'Out', qty: 1, warehouseId: wb, sourceType: 'transfer', sourceId: 't9' }))).rejects.toThrow(/in that warehouse/);
    // Supplier payments: only to the order's vendor.
    const vpo = await as('accounts', () => insert('purchaseOrders', { status: 'Ordered', date: '2026-11-12', vendorId: 'v1', ...lines(100) }));
    await expect(as('accounts', () => insert('supplierPayments', { purchaseOrderId: vpo.id, vendorId: 'v2', amount: 10 }))).rejects.toThrow(/another vendor/);
    await as('accounts', () => insert('supplierPayments', { purchaseOrderId: vpo.id, vendorId: 'v1', amount: 10 }));
    await expect(as('accounts', () => q(`update records set data = data || '{"status": "Cancelled"}' where id = $1`, [vpo.id]))).rejects.toThrow(/Delete them before cancelling/);
  });

  it('third review: numbering is each record\'s own series and year; an issued invoice is locked', async () => {
    await expect(as('accounts', () => insert('invoices', { status: 'Sent', date: '2026-11-12', ...lines(10), _numKey: 'invoices', _numPrefix: 'QT/26-27/' }))).rejects.toThrow(/Invalid numbering/);
    await expect(as('accounts', () => insert('invoices', { status: 'Sent', date: '2026-11-12', ...lines(10), _numKey: 'invoices:99-00', _numPrefix: 'INV/26-27/' }))).rejects.toThrow(/Invalid numbering/);
    await expect(as('accounts', () => insert('invoices', { status: 'Sent', date: '2026-11-12', ...lines(10), _numKey: 'invoices:27-28', _numPrefix: 'INV/27-28/' }))).rejects.toThrow(/Invalid numbering/);
    const inv = await as('accounts', () => insert('invoices', { status: 'Sent', date: '2026-11-12', ...lines(10), _numKey: 'invoices:26-27', _numPrefix: 'INV/26-27/' }));
    await expect(as('accounts', () => q(`update records set data = data || '{"date": "2027-04-02"}' where id = $1`, [inv.id]))).rejects.toThrow(/another financial year/);
    await expect(as('accounts', () => q(`update records set data = data || '{"status": "Draft"}' where id = $1`, [inv.id]))).rejects.toThrow(/cannot go back to Draft/);
    await expect(as('accounts', () => q(`update records set data = data || jsonb_build_object('items', $2::jsonb, 'grandTotal', 20) where id = $1`, [inv.id, JSON.stringify(lines(20).items)]))).rejects.toThrow(/cannot be changed/);
    await as('accounts', () => q(`update records set data = data || '{"notes": "sent by email"}' where id = $1`, [inv.id])); // notes: fine
    await as('accounts', () => q(`update records set data = data || '{"status": "Cancelled"}' where id = $1`, [inv.id]));
    await expect(as('accounts', () => q(`update records set data = data || '{"status": "Sent"}' where id = $1`, [inv.id]))).rejects.toThrow(/cannot be used again/);
  });

  it('third review: a restore keeps who created each record; history entries are notes only and never open files', async () => {
    const id = randomUUID();
    await as('owner', () => q('select restore_records($1::jsonb)', [JSON.stringify([{ id, entity: 'leads', data: { name: 'Mine', phone: '9000000077' }, created_by: ids.sales }])]));
    expect((await q('select created_by from records where id = $1', [id])).rows[0].created_by).toBe(ids.sales);
    const lead = await as('sales', () => insert('leads', { name: 'Seen', phone: '9000000078' }));
    await expect(as('tech', () => insert('activity', { on: 'leads', recordId: lead.id, kind: 'note', text: 'x', x: { path: `${ids.owner}/kyc.pdf` } }))).rejects.toThrow();
    await as('owner', () => q(`insert into storage.objects (bucket_id, name) values ('files', $1)`, [`${ids.owner}/secret.pdf`]));
    await expect(as('accounts', () => insert('activity', { on: 'leads', recordId: lead.id, kind: 'changed', changes: [{ field: 'name', from: 'a', to: 'b' }] }))).rejects.toThrow();
  });
});

describe('businesses and the subscription', () => {
  const biz = async (who: string) => (await q('select business_id from profiles where id = $1', [ids[who]])).rows[0].business_id as string;
  const info = async (who: string) => (await as(who, () => q('select my_business_info() i'))).rows[0].i as Record<string, unknown>;
  const DAY = 86400000;

  it('a new business needs a mobile number, gets a 15-day trial, and each number gets one trial', async () => {
    await expect(signup('nophone', 'np@other.com', true, undefined, { own: true })).rejects.toThrow(/mobile number to start the free trial/);
    await signup('rival', 'rival@other.com', true, '9811111111', { own: true });
    await expect(signup('rival2', 'rival2@other.com', true, '+91 98111 11111', { own: true })).rejects.toThrow(/already used/);
    const b = (await q('select * from businesses where id = $1', [await biz('rival')])).rows[0];
    expect(b.owner_id).toBe(ids.rival);
    expect(b.paid_until).toBeNull();
    const left = (new Date(b.trial_ends as string).getTime() - Date.now()) / DAY;
    expect(left).toBeGreaterThan(14.99);
    expect(left).toBeLessThanOrEqual(15);
    expect(await info('rival')).toMatchObject({ active: true, isOwner: true, plan: null });
    expect((await q('select role from profiles where id = $1', [ids.rival])).rows[0].role).toBe('admin');
  });

  it('two businesses never see or change each other\'s data, people or files', async () => {
    const theirs = await as('rival', () => insert('leads', { name: 'Rival lead', phone: '9000007001' }));
    expect(theirs.business_id).toBe(await biz('rival'));
    const mine = await as('owner', () => insert('leads', { name: 'Our lead', phone: '9000007002' }));
    expect((await as('owner', () => q('select id from records where id = $1', [theirs.id]))).rows).toHaveLength(0);
    expect((await as('rival', () => q('select id from records where id = $1', [mine.id]))).rows).toHaveLength(0);
    expect((await as('rival', () => q(`select id from records where entity = 'leads'`))).rows.map((r) => r.id)).toEqual([theirs.id]);
    expect((await as('rival', () => q(`update records set data = data || '{"name": "x"}' where id = $1 returning id`, [mine.id]))).rows).toHaveLength(0);
    expect((await as('rival', () => q('delete from records where id = $1 returning id', [mine.id]))).rows).toHaveLength(0);
    // A record sent with another business's id lands in your own business; another business's record id is refused.
    const planted = await as('rival', () => q(`insert into records (id, entity, data, business_id) values ($1, 'leads', '{"name": "P", "phone": "9000007003"}', $2) returning business_id`, [randomUUID(), mine.business_id]));
    expect(planted.rows[0].business_id).toBe(theirs.business_id);
    await expect(as('rival', () => q(`insert into records (id, entity, data) values ($1, 'leads', '{"name": "P", "phone": "9000007004"}')`, [mine.id]))).rejects.toThrow();
    await expect(as('rival', () => q(`insert into records (id, entity, data) values ($1, 'leads', '{"name": "P", "phone": "9000007004"}') on conflict (id) do update set data = excluded.data`, [mine.id]))).rejects.toThrow();
    await expect(as('rival', () => q('select restore_records($1::jsonb)', [JSON.stringify([{ id: mine.id, entity: 'leads', data: { name: 'Taken', phone: '9000007005' } }])]))).rejects.toThrow(/another business/);
    // People and businesses.
    expect((await as('rival', () => q('select id from profiles'))).rows.map((r) => r.id)).toEqual([ids.rival]);
    expect((await as('rival', () => q('select id from user_phones'))).rows.map((r) => r.id)).toEqual([ids.rival]);
    expect((await as('rival', () => q('select id, join_code from businesses'))).rows).toHaveLength(0); // only through my_business_info()
    expect((await as('owner', () => q('select id from profiles where id = $1', [ids.rival]))).rows).toHaveLength(0);
    await expect(as('rival', () => q('select set_user_phone($1, $2)', [ids.sales, '9822222222']))).rejects.toThrow(/no longer exists/);
    expect((await as('rival', () => q(`update profiles set role = 'pending' where id = $1 returning id`, [ids.sales]))).rows).toHaveLength(0);
    await expect(as('rival', () => q('select admin_delete_user($1)', [ids.sales]))).rejects.toThrow();
    await as('rival', () => q('update profiles set business_id = $1 where id = $2', [mine.business_id, ids.rival]));
    expect(await biz('rival')).toBe(theirs.business_id); // cannot move into another business
    // Files: another business's admin neither sees nor deletes them.
    await as('sales', () => q(`insert into storage.objects (bucket_id, name) values ('files', $1)`, [`${ids.sales}/quote.pdf`]));
    expect((await as('rival', () => q('select id from storage.objects where name = $1', [`${ids.sales}/quote.pdf`]))).rows).toHaveLength(0);
    expect((await as('rival', () => q('delete from storage.objects where name = $1 returning id', [`${ids.sales}/quote.pdf`]))).rows).toHaveLength(0);
    // Stock is counted per business.
    const p = randomUUID();
    await as('owner', () => insert('stockMoves', { productId: p, qty: 5, direction: 'In' }));
    await expect(as('rival', () => insert('stockMoves', { productId: p, qty: 1, direction: 'Out' }))).rejects.toThrow(/Only 0 in stock/);
  });

  it('each business numbers its own documents', async () => {
    const inv = await as('rival', () => insert('invoices', { status: 'Sent', date: '2027-05-01', ...lines(1), _numKey: 'invoices:27-28', _numPrefix: 'INV/27-28/' }));
    expect(inv.data).toMatchObject({ number: 'INV/27-28/0001' });
    const keys = (await q(`select entity from counters where entity like '%|invoices:27-28' order by value`)).rows.map((r) => r.entity);
    expect(keys).toEqual([`${await biz('rival')}|invoices:27-28`, `${await biz('owner')}|invoices:27-28`]);
  });

  it('anyone can read the plans and prices (GST included); nobody can change them from the app', async () => {
    const r = await as(null, () => q('select id, months, amount_paise from plans order by sort'));
    expect(r.rows).toEqual([
      { id: '1m', months: 1, amount_paise: 100000 }, { id: '3m', months: 3, amount_paise: 250000 },
      { id: '6m', months: 6, amount_paise: 450000 }, { id: '12m', months: 12, amount_paise: 750000 },
    ]);
    expect((await as('owner', () => q('update plans set amount_paise = 100 returning id'))).rows).toHaveLength(0);
    await expect(as('owner', () => q(`insert into plans (id, months, amount_paise, label) values ('free', 120, 0, 'x')`))).rejects.toThrow();
  });

  it('website enquiries go to the business in the link', async () => {
    await q('delete from enquiry_log');
    await expect(as(null, () => q(`select web_enquiry('V', '9000007021', '', '', '', '')`))).rejects.toThrow(/not complete/);
    await expect(as(null, () => q(`select web_enquiry('V', '9000007021', '', '', '', '', $1::uuid)`, [randomUUID()]))).rejects.toThrow(/not complete/);
    const rb = await biz('rival');
    await as(null, () => q(`select web_enquiry('Rival visitor', '9000007022', '', '', '', '', $1::uuid)`, [rb]));
    expect((await as('rival', () => q(`select id from records where entity = 'leads' and data->>'name' = 'Rival visitor'`))).rows).toHaveLength(1);
    expect((await as('owner', () => q(`select id from records where entity = 'leads' and data->>'name' = 'Rival visitor'`))).rows).toHaveLength(0);
  });

  it('after the trial a business can still read and export, but change nothing; nobody can extend it from the app', async () => {
    const b = await biz('rival');
    await q(`update businesses set trial_ends = now() - interval '1 minute' where id = $1`, [b]);
    expect(await info('rival')).toMatchObject({ active: false });
    expect((await as('rival', () => q(`select id from records where entity = 'leads'`))).rows.length).toBeGreaterThan(0);
    await expect(as('rival', () => insert('leads', { name: 'Late', phone: '9000007010' }))).rejects.toThrow(/subscription has ended, so changes are paused/);
    await expect(as('rival', () => q(`update records set data = data || '{"city": "x"}' where entity = 'leads'`))).rejects.toThrow(/subscription has ended/);
    await expect(as('rival', () => q(`delete from records where entity = 'leads'`))).rejects.toThrow(/subscription has ended/);
    // Deleting your own login still works (app stores require it), and it clears only "created by".
    await signup('rivalStaff', 'rs@other.com', true, undefined, { code: (await q('select join_code from businesses where id = $1', [b])).rows[0].join_code as string });
    await q(`update profiles set role = 'sales' where id = $1`, [ids.rivalStaff]);
    await q(`update businesses set trial_ends = now() + interval '1 day' where id = $1`, [b]);
    await as('rivalStaff', () => insert('leads', { name: 'By staff', phone: '9000007013' }));
    await q(`update businesses set trial_ends = now() - interval '1 minute' where id = $1`, [b]);
    await as('rivalStaff', () => q('select delete_my_account()'));
    expect((await q(`select created_by from records where data->>'name' = 'By staff'`)).rows[0].created_by).toBeNull();
    await expect(as('rival', () => q(`insert into storage.objects (bucket_id, name) values ('files', $1)`, [`${ids.rival}/late.pdf`]))).rejects.toThrow();
    await expect(as('rival', () => q('select restore_records($1::jsonb)', ['[]']))).rejects.toThrow();
    await expect(as(null, () => q(`select web_enquiry('V', '9000007011', '', '', '', '', $1::uuid)`, [b]))).rejects.toThrow(/not taking online enquiries/);
    // The rows and functions that decide the subscription are out of reach of the app.
    expect((await as('rival', () => q(`update businesses set paid_until = now() + interval '10 years', trial_ends = now() + interval '10 years' returning id`))).rows).toHaveLength(0);
    await expect(as('rival', () => q(`insert into businesses (name, owner_id) values ('Second', $1)`, [ids.rival]))).rejects.toThrow();
    await expect(as('rival', () => q(`insert into subscription_payments (business_id, plan, amount_paise, order_id, status) values ($1, '12m', 1, 'fake', 'paid')`, [b]))).rejects.toThrow();
    for (const who of ['rival', null] as const)
      for (const f of [`billing_quote('${ids.rival}', '1m')`, `billing_record_order('${ids.rival}', '1m', 'o', 100000)`, `apply_subscription_payment('o', 'p', 100000)`, `vendor_extend('${b}', 365)`])
        await expect(as(who, () => q(`select public.${f}`))).rejects.toThrow(/permission denied/);
    expect(await info('rival')).toMatchObject({ active: false });
  });

  it('payments (server only): the price comes from the plan, a payment counts once, and paying early adds on', async () => {
    const b = await biz('rival');
    expect((await q(`select billing_quote($1, '12m') q`, [ids.rival])).rows[0].q).toMatchObject({ business: b, months: 12, amount: 750000 });
    await expect(q(`select billing_quote($1, '12m')`, [ids.sales])).rejects.toThrow(/Only the business admin/);
    await expect(q(`select billing_quote($1, '24m')`, [ids.rival])).rejects.toThrow(/Unknown plan/);
    await expect(q(`select billing_record_order($1, '1m', 'order_A', 1)`, [ids.rival])).rejects.toThrow(/does not match/);
    await q(`select billing_record_order($1, '1m', 'order_A', 100000)`, [ids.rival]);
    await expect(q(`select apply_subscription_payment('order_A', 'pay_A', 99900)`)).rejects.toThrow(/does not match/);
    await expect(q(`select apply_subscription_payment('order_X', 'pay_A', 100000)`)).rejects.toThrow(/Unknown order/);
    const r1 = (await q(`select apply_subscription_payment('order_A', 'pay_A', 100000) r`)).rows[0].r as { already: boolean; paidUntil: string };
    expect(r1.already).toBe(false);
    const month = (new Date(r1.paidUntil).getTime() - Date.now()) / DAY;
    expect(month).toBeGreaterThan(27.9);
    expect(month).toBeLessThan(31.1);
    // The same payment reported again (the app and the webhook both report it): nothing more.
    expect((await q(`select apply_subscription_payment('order_A', 'pay_A', 100000) r`)).rows[0].r).toEqual({ already: true, paidUntil: r1.paidUntil });
    expect(await info('rival')).toMatchObject({ active: true, plan: '1m' });
    await as('rival', () => insert('leads', { name: 'Back', phone: '9000007012' }));
    // One payment cannot pay for a second order.
    await q(`select billing_record_order($1, '3m', 'order_B', 250000)`, [ids.rival]);
    await expect(q(`select apply_subscription_payment('order_B', 'pay_A', 250000)`)).rejects.toThrow(/already used/);
    const r2 = (await q(`select apply_subscription_payment('order_B', 'pay_B', 250000) r`)).rows[0].r as { paidUntil: string };
    expect((await q(`select $1::timestamptz = $2::timestamptz + interval '3 months' ok`, [r2.paidUntil, r1.paidUntil])).rows[0].ok).toBe(true);
    // The history: the business admin sees it; their staff and other businesses do not.
    expect((await as('rival', () => q('select order_id, status, amount_paise from subscription_payments order by created_at'))).rows).toEqual([
      { order_id: 'order_A', status: 'paid', amount_paise: 100000 }, { order_id: 'order_B', status: 'paid', amount_paise: 250000 }]);
    expect((await as('owner', () => q('select id from subscription_payments'))).rows).toHaveLength(0);
  });

  it('paying during the free trial starts after the trial ends', async () => {
    await q(`select billing_record_order($1, '6m', 'order_C', 450000)`, [ids.owner]);
    await q(`select apply_subscription_payment('order_C', 'pay_C', 450000)`);
    const r = (await q(`select sp.period_start = b.trial_ends s, sp.period_end = b.trial_ends + interval '6 months' e, b.paid_until = sp.period_end p
                        from subscription_payments sp join businesses b on b.id = sp.business_id where sp.order_id = 'order_C'`)).rows[0];
    expect(r).toEqual({ s: true, e: true, p: true });
    expect((await as('sales', () => q('select id from subscription_payments'))).rows).toHaveLength(0);
    expect(await info('sales')).toMatchObject({ active: true, plan: '6m', isOwner: false });
  });

  it('the company code: only the admin sees and changes it; an old code stops working; joiners wait for approval', async () => {
    expect((await info('sales')).joinCode).toBeNull();
    const old = (await info('owner')).joinCode as string;
    expect(old).toBe(ownerCode);
    await expect(as('sales', () => q('select regenerate_join_code()'))).rejects.toThrow(/Only the admin/);
    const fresh = (await as('owner', () => q('select regenerate_join_code() c'))).rows[0].c as string;
    expect(fresh).toMatch(/^[0-9A-F]{10}$/);
    expect(fresh).not.toBe(old);
    ownerCode = fresh;
    // The sign-up screen asks first (Supabase would hide the reason): only yes or no, for anyone.
    expect((await as(null, () => q('select join_code_ok($1) ok', [old]))).rows[0].ok).toBe(false);
    expect((await as(null, () => q('select join_code_ok($1) ok', [` ${fresh.toLowerCase()} `]))).rows[0].ok).toBe(true);
    await expect(signup('late', 'late@biz.com', true, undefined, { code: old })).rejects.toThrow(/No business has this company code/);
    await signup('late', 'late@biz.com', true, undefined, { code: ` ${fresh.toLowerCase()} ` });
    expect((await q('select role, business_id from profiles where id = $1', [ids.late])).rows[0]).toEqual({ role: 'pending', business_id: await biz('owner') });
    expect((await as('late', () => q('select id from records'))).rows).toHaveLength(0);
    expect((await info('late')).joinCode).toBeNull();
    // Not through the table either, for staff or people waiting for approval.
    for (const who of ['late', 'sales'])
      expect((await as(who, () => q('select join_code from businesses'))).rows).toHaveLength(0);
    // Checking codes from the sign-up screen: 20 tries an hour per connection.
    await q('delete from code_check_log');
    for (let i = 0; i < 20; i++) await as(null, () => q('select join_code_ok($1)', ['0000000000']));
    await expect(as(null, () => q('select join_code_ok($1)', [fresh]))).rejects.toThrow(/Too many tries/);
    await q('delete from code_check_log');
  });

  it('when the last person of a business deletes their account, the business and its data go too', async () => {
    await signup('solo', 'solo@one.com', true, '9811111122', { own: true });
    const b = await biz('solo');
    await as('solo', () => insert('leads', { name: 'Solo lead', phone: '9000007031' }));
    await as('solo', () => insert('invoices', { status: 'Sent', date: '2026-11-12', ...lines(10), _numKey: 'invoices:26-27', _numPrefix: 'INV/26-27/' }));
    await as('solo', () => q('select delete_my_account()'));
    for (const t of ['businesses where id', 'records where business_id', 'profiles where business_id'])
      expect((await q(`select count(*)::int n from ${t} = $1`, [b])).rows[0].n).toBe(0);
    expect((await q(`select count(*)::int n from counters where entity like $1`, [`${b}|%`])).rows[0].n).toBe(0);
    expect((await q('select count(*)::int n from user_phones where phone = $1', ['+919811111122'])).rows[0].n).toBe(0);
    // Others are untouched.
    expect((await q('select count(*)::int n from records where business_id = $1', [await biz('owner')])).rows[0].n).toBeGreaterThan(0);
  });

  it('deleting everything and signing up again starts no new free trial; payments stay on record', async () => {
    await signup('cycler', 'Cycle@One.com', true, '9811122233', { own: true });
    expect(await info('cycler')).toMatchObject({ active: true, trialRefused: false });
    await q(`select billing_record_order($1, '1m', 'order_CYCLE', 100000)`, [ids.cycler]);
    await q(`select apply_subscription_payment('order_CYCLE', 'pay_CYCLE', 100000)`);
    const first = await biz('cycler');
    await as('cycler', () => insert('leads', { name: 'Kept in a backup', phone: '9000008001' }));
    await as('cycler', () => q('select delete_my_account()'));
    expect((await q('select count(*)::int n from businesses where id = $1', [first])).rows[0].n).toBe(0);
    // The payment stays on record (money received), with the business's name.
    expect((await q(`select business_id, business_name, status from subscription_payments where order_id = 'order_CYCLE'`)).rows[0])
      .toEqual({ business_id: null, business_name: 'cycler', status: 'paid' });
    // Same email and mobile again: a business, but no second trial — and so no restoring the backup into it.
    await signup('cycler2', 'cycle@one.com', true, '98111 22233', { own: true });
    expect(await info('cycler2')).toMatchObject({ active: false, trialRefused: true });
    await expect(as('cycler2', () => q('select restore_records($1::jsonb)', [JSON.stringify([{ id: randomUUID(), entity: 'leads', data: { name: 'Back', phone: '9000008002' } }])]))).rejects.toThrow();
    await expect(as('cycler2', () => insert('leads', { name: 'Free', phone: '9000008003' }))).rejects.toThrow(/subscription has ended/);
    // Another email with that mobile number, or that email with another number: no trial either.
    await as('cycler2', () => q('select delete_my_account()'));
    await signup('cycler3', 'new-address@one.com', true, '9811122233', { own: true });
    expect(await info('cycler3')).toMatchObject({ active: false, trialRefused: true });
    await signup('cycler4', 'CYCLE@one.com', true, '9811122244', { own: true });
    expect(await info('cycler4')).toMatchObject({ active: false, trialRefused: true });
    // A new person (new email and number) still gets theirs; and buying a plan works for the refused ones.
    await signup('fresh', 'fresh@one.com', true, '9811122255', { own: true });
    expect(await info('fresh')).toMatchObject({ active: true, trialRefused: false });
    await q(`select billing_record_order($1, '1m', 'order_CYCLE4', 100000)`, [ids.cycler4]);
    await q(`select apply_subscription_payment('order_CYCLE4', 'pay_CYCLE4', 100000)`);
    expect(await info('cycler4')).toMatchObject({ active: true });
    // The plan's length is what was ordered, even if the plan changes before the payment arrives.
    await q(`select billing_record_order($1, '1m', 'order_LEN', 100000)`, [ids.fresh]);
    await q(`update plans set months = 2 where id = '1m'`);
    try {
      await q(`select apply_subscription_payment('order_LEN', 'pay_LEN', 100000)`);
      expect((await q(`select period_end = period_start + interval '1 month' ok from subscription_payments where order_id = 'order_LEN'`)).rows[0].ok).toBe(true);
    } finally { await q(`update plans set months = 1 where id = '1m'`); }
  });

  it('with SMS codes switched on, a free trial needs the owner\'s confirmed mobile number, once per number', async () => {
    await q('update app_config set trial_needs_sms = true');
    try {
      await signup('smsA', 'sms-a@one.com', true, '9811133344', { own: true, verifiedPhone: false });
      expect(await info('smsA')).toMatchObject({ active: false }); // number typed, not confirmed
      await expect(as('smsA', () => insert('leads', { name: 'Not yet', phone: '9000009001' }))).rejects.toThrow(/Please sign in again/);
      await q(`update auth.users set phone = '919811133344', phone_confirmed_at = now() where id = $1`, [ids.smsA]);
      expect(await info('smsA')).toMatchObject({ active: true, trialRefused: false });
      await as('smsA', () => insert('leads', { name: 'Now', phone: '9000009002' }));
      await as('smsA', () => q('select delete_my_account()'));
      // A made-up number at sign-up, then the same SIM confirmed again: no second trial.
      await signup('smsB', 'sms-b@one.com', true, '9811133399', { own: true, verifiedPhone: false });
      await q(`update auth.users set phone = '919811133344', phone_confirmed_at = now() where id = $1`, [ids.smsB]);
      expect(await info('smsB')).toMatchObject({ active: false, trialRefused: true });
    } finally { await q('update app_config set trial_needs_sms = false'); }
  });

  it('files belong to the business of whoever uploaded them: a copied path opens nothing; former staff\'s files stay', async () => {
    // Another business copies the path of this business's KYC file into one of its own records.
    const rb = await biz('rival');
    await q(`update businesses set paid_until = now() + interval '30 days' where id = $1`, [rb]);
    await as('rival', () => insert('documents', { name: 'Copied', file: { name: 'kyc.pdf', path: `${ids.owner}/kyc.pdf` } }));
    expect((await as('rival', () => q('select id from storage.objects where name = $1', [`${ids.owner}/kyc.pdf`]))).rows).toHaveLength(0);
    // A staff member uploads a photo, it is filed on a record, then they leave.
    await signup('photog', 'photog@biz.com', true, undefined, { code: ownerCode });
    await q(`update profiles set role = 'technician' where id = $1`, [ids.photog]);
    await as('photog', () => q(`insert into storage.objects (bucket_id, name) values ('files', $1)`, [`${ids.photog}/site.jpg`]));
    await as('owner', () => insert('documents', { name: 'Site', file: { name: 'site.jpg', path: `${ids.photog}/site.jpg` } }));
    await as('owner', () => q('select admin_delete_user($1)', [ids.photog]));
    expect((await as('owner', () => q('select id from storage.objects where name = $1', [`${ids.photog}/site.jpg`]))).rows).toHaveLength(1);
    expect((await as('sales', () => q('select id from storage.objects where name = $1', [`${ids.photog}/site.jpg`]))).rows).toHaveLength(1);
    expect((await as('rival', () => q('select id from storage.objects where name = $1', [`${ids.photog}/site.jpg`]))).rows).toHaveLength(0);
  });

  it('a website enquiry from someone signed in goes to the business in the link, as nobody\'s; inserts from nobody stop at once', async () => {
    await q('delete from enquiry_log');
    const rb = await biz('rival'), ob = await biz('owner');
    await as('late', () => q(`select web_enquiry('Pending person', '9000009101', '', '', '', '', $1::uuid)`, [rb]));
    const lead = (await q(`select business_id, created_by from records where data->>'name' = 'Pending person'`)).rows;
    expect(lead).toEqual([{ business_id: rb, created_by: null }]);
    // Anonymous direct insert naming a business: refused before any rule could reveal that business's figures.
    await expect(as(null, () => q(`insert into records (id, entity, data, business_id) values ($1, 'payments', $2, $3)`,
      [randomUUID(), JSON.stringify({ invoiceId: randomUUID(), amount: 1 }), ob]))).rejects.toThrow(/Please sign in again/);
  });

  it('a database from before businesses becomes one business on upgrade, with its numbers carrying on', async () => {
    const keep = db;
    db = new PGlite();
    try {
      await db.exec(SUPABASE_STUBS);
      const sql = readFileSync('supabase/schema.sql', 'utf8');
      await db.exec(sql);
      await db.exec(GRANTS);
      ownerCode = '';
      await signup('oldAdmin', 'admin@old.com', true, '9700000001');
      const code = (await q('select join_code from businesses')).rows[0].join_code as string;
      await signup('oldStaff', 'staff@old.com', true, undefined, { code });
      await q(`update profiles set role = 'sales' where id = $1`, [ids.oldStaff]);
      await as('oldAdmin', () => insert('_settings', { companyName: 'Old Solar Co' }));
      await as('oldAdmin', () => insert('invoices', { status: 'Sent', date: '2026-11-12', ...lines(10), _numKey: 'invoices:26-27', _numPrefix: 'INV/26-27/' }));
      // Make it look like the old schema's data: no businesses, counters without a business.
      await db.exec(`
        alter table records disable trigger user; alter table profiles disable trigger user;
        update records set business_id = null; update profiles set business_id = null;
        alter table records enable trigger user; alter table profiles enable trigger user;
        delete from businesses;
        update counters set entity = split_part(entity, '|', 2);`);
      await db.exec(sql); // the upgrade
      const bs = (await q('select id, owner_id, name from businesses')).rows;
      expect(bs).toHaveLength(1);
      expect(bs[0]).toMatchObject({ owner_id: ids.oldAdmin, name: 'Old Solar Co' });
      expect((await q('select count(*)::int n from profiles where business_id is distinct from $1', [bs[0].id])).rows[0].n).toBe(0);
      expect((await q('select count(*)::int n from records where business_id is distinct from $1', [bs[0].id])).rows[0].n).toBe(0);
      expect((await as('oldAdmin', () => q(`select id from records where entity = 'invoices'`))).rows).toHaveLength(1);
      expect((await as('oldStaff', () => q('select id from profiles'))).rows).toHaveLength(2);
      const next = await as('oldAdmin', () => insert('invoices', { status: 'Sent', date: '2026-11-13', ...lines(10), _numKey: 'invoices:26-27', _numPrefix: 'INV/26-27/' }));
      expect(next.data).toMatchObject({ number: 'INV/26-27/0002' });
      await db.exec(sql); // and running it again changes nothing
      expect((await q('select count(*)::int n from businesses')).rows[0].n).toBe(1);
    } finally {
      await db.close();
      db = keep;
    }
  }, 60000);
});
