import { beforeEach, describe, expect, it } from 'vitest';
import { LocalBackend } from './local';
import { DuplicateError, Store, ValidationError } from './store';
import { ConflictError } from './types';
import { computeAlerts } from '../alerts';
import type { Rec } from '../schema';

async function freshStore() {
  const b = new LocalBackend();
  const { user: admin } = await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
  const s = new Store(b);
  s.user = admin;
  await s.load();
  return s;
}

const item = (rate: number, qty = 1, gstRate = 0) => ({ description: 'Item', qty, rate, gstRate });

describe('auth (device mode)', () => {
  it('sets up once, signs in, rejects wrong password and disabled users', async () => {
    const b = new LocalBackend();
    expect(await b.needsSetup()).toBe(true);
    await b.setupAdmin('A', 'Admin@Example.com', 'password123', '9876543210');
    await expect(b.setupAdmin('B', 'b@x.com', 'password123', '9876543210')).rejects.toThrow(/already complete/);
    await b.signOut();
    expect(await b.currentUser()).toBeNull();
    await expect(b.signIn('admin@example.com', 'nope')).rejects.toThrow(/Wrong/);
    const me = await b.signIn(' ADMIN@example.com ', 'password123');
    expect(me.role).toBe('admin');

    await b.saveUser({ id: 'u2', name: 'S', email: 's@x.com', phone: '+918100000001', role: 'sales', active: false }, 'password456');
    await expect(b.signIn('s@x.com', 'password456')).rejects.toThrow(/disabled/);
  });

  it('enforces password length, unique emails and at least one admin', async () => {
    const b = new LocalBackend();
    await expect(b.setupAdmin('A', 'a@x.com', 'short', '9876543210')).rejects.toThrow(/8 characters/);
    const { user: a } = await b.setupAdmin('A', 'a@x.com', 'password123', '9876543210');
    await expect(b.saveUser({ id: 'n', name: 'N', email: 'A@x.com', phone: '+918100000002', role: 'sales', active: true }, 'password123')).rejects.toThrow(/already exists/);
    await expect(b.saveUser({ ...a, role: 'sales' })).rejects.toThrow(/admin/);
  });

  it('mobile number: required for new accounts, valid, unique, stored as +91…; older accounts are asked for it', async () => {
    const b = new LocalBackend();
    await expect(b.setupAdmin('A', 'a@x.com', 'password123', '')).rejects.toThrow(/mobile/);
    await expect(b.setupAdmin('A', 'a@x.com', 'password123', '5876543210')).rejects.toThrow(/valid 10-digit/);
    const { user: a } = await b.setupAdmin('A', 'a@x.com', 'password123', '098765 43210');
    expect(a.phone).toBe('+919876543210');
    expect(await b.mobileStatus(a)).toBe('verified');
    const staff = { id: 's1', name: 'S', email: 's@x.com', role: 'sales' as const, active: true };
    await expect(b.saveUser(staff, 'password123')).rejects.toThrow(/Mobile number is required/);
    await expect(b.saveUser({ ...staff, phone: '+91 98765 43210' }, 'password123')).rejects.toThrow(/already used/);
    await expect(b.saveUser({ ...staff, phone: '99999 99999' }, 'password123')).rejects.toThrow(/valid 10-digit/);
    expect((await b.saveUser({ ...staff, phone: '91-70000-12345' }, 'password123')).phone).toBe('+917000012345');
    // Once there is a number it cannot be removed.
    await expect(b.saveUser({ ...staff, phone: '' })).rejects.toThrow(/required/);

    // An account made before numbers were required can still be edited, and adds its own number at sign-in.
    const users = JSON.parse(localStorage.getItem('ss1:users')!);
    delete users[0].phone;
    localStorage.setItem('ss1:users', JSON.stringify(users));
    const old = (await b.currentUser())!;
    expect(old.phone).toBeUndefined();
    expect(await b.mobileStatus(old)).toBe('missing');
    await b.saveUser({ ...old, name: 'A renamed' });
    await expect(b.setMyPhone('7000012345')).rejects.toThrow(/already used/);
    await b.setMyPhone('8000012345');
    expect((await b.currentUser())!.phone).toBe('+918000012345');
  });

  it('device mode: "Create account" makes a separate business with its own users, records, numbers and recovery code', async () => {
    const b = new LocalBackend();
    const { user: owner } = await b.setupAdmin('A', 'a@x.com', 'password123', '9876543210');
    const sa = new Store(b); sa.user = owner; await sa.load();
    const leadA = await sa.create('leads', { name: 'Lead of A', phone: '9000000001' });
    await b.signOut();

    await expect(b.createBusiness!('B', 'Sunrise Solar', 'A@x.com', 'password123', '7000012345')).rejects.toThrow(/already has an account/);
    await expect(b.createBusiness!('B', '', 'b@x.com', 'password123', '7000012345')).rejects.toThrow(/business name/);
    await expect(b.createBusiness!('B', 'Sunrise Solar', 'b@x.com', 'short', '7000012345')).rejects.toThrow(/8 characters/);
    const r = await b.createBusiness!('B', 'Sunrise Solar', ' B@x.com ', 'password123', '9876543210'); // same phone is fine in another business
    expect(r.user).toMatchObject({ email: 'b@x.com', role: 'admin', active: true });
    expect(r.recoveryCode).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const sb = new Store(b); sb.user = r.user; await sb.load();
    // A fresh, empty business named as asked; nothing of the other one is visible.
    expect(sb.settings().companyName).toBe('Sunrise Solar');
    expect(sb.all('leads')).toHaveLength(0);
    expect(sb.get('leads', leadA.id)).toBeUndefined();
    expect((await b.listUsers()).map((u) => u.email)).toEqual(['b@x.com']);
    const leadB = await sb.create('leads', { name: 'Lead of B', phone: '9000000001' }); // no clash with A's phone
    expect(leadB.number).toBe('LD-0001'); // its own numbering
    // A user added in B cannot reuse an email from A.
    await expect(b.saveUser({ id: 'x', name: 'X', email: 'a@x.com', phone: '7000011111', role: 'sales', active: true }, 'password123')).rejects.toThrow(/another business/);

    // Signing in picks the right business by email.
    await b.signOut();
    await b.signIn('a@x.com', 'password123');
    const sa2 = new Store(b); sa2.user = await b.currentUser(); await sa2.load();
    expect(sa2.all('leads').map((l) => l.name)).toEqual(['Lead of A']);
    await b.signOut();
    // A new LocalBackend (page reload) stays in the business of the signed-in person.
    await b.signIn('b@x.com', 'password123');
    const reloaded = new LocalBackend();
    expect((await reloaded.currentUser())!.email).toBe('b@x.com');
    expect((await reloaded.loadAll()).leads.map((l) => l.name)).toEqual(['Lead of B']);
    // Recovery codes are per business.
    await reloaded.signOut();
    await expect(reloaded.recoverWithCode!('a@x.com', r.recoveryCode!, 'newpassword1')).rejects.toThrow(/not valid/);
    await reloaded.recoverWithCode!('b@x.com', r.recoveryCode!, 'newpassword1');
    // The only person in a created business takes it with them when deleting the account.
    await reloaded.deleteMyAccount();
    await expect(reloaded.signIn('b@x.com', 'newpassword1')).rejects.toThrow(/Wrong/);
    expect(Object.keys(localStorage).some((k) => k.includes(':w:'))).toBe(false);
    await reloaded.signIn('a@x.com', 'password123');
    expect((await reloaded.loadAll()).leads).toHaveLength(1);
  });

  it('device mode: the admin recovers with the code using email or mobile number; staff cannot', async () => {
    const b = new LocalBackend();
    const { recoveryCode } = await b.setupAdmin('A', 'a@x.com', 'password123', '9876543210');
    await b.saveUser({ id: 's1', name: 'S', email: 's@x.com', phone: '7000012345', role: 'sales', active: true }, 'password123');
    await b.signOut();
    await expect(b.recoverWithCode!('7000012345', recoveryCode!, 'newpassword1')).rejects.toThrow(/No admin account has that mobile/);
    const r = await b.recoverWithCode!('+91 98765 43210', recoveryCode!, 'newpassword1');
    expect(r.user.email).toBe('a@x.com');
    await expect(b.recoverWithCode!('a@x.com', recoveryCode!, 'newpassword2')).rejects.toThrow(/not valid/); // used up
    expect(b.phoneOtp).toBe(false);
  });

  it('changes password', async () => {
    const b = new LocalBackend();
    await b.setupAdmin('A', 'a@x.com', 'password123', '9876543210');
    await expect(b.changePassword('wrong', 'newpassword1')).rejects.toThrow(/wrong/);
    await b.changePassword('password123', 'newpassword1');
    await b.signOut();
    await expect(b.signIn('a@x.com', 'password123')).rejects.toThrow();
    await b.signIn('a@x.com', 'newpassword1');
  });
});

describe('store', () => {
  let s: Store;
  beforeEach(async () => { s = await freshStore(); });

  it('creates with defaults, numbering and persistence', async () => {
    const l1 = await s.create('leads', { name: 'Ravi', phone: '9876543210' });
    const l2 = await s.create('leads', { name: 'Asha', phone: '9876500000' });
    expect(l1.status).toBe('New');
    expect(l1.number).toBe('LD-0001');
    expect(l2.number).toBe('LD-0002');
    await s.remove('leads', l2.id);
    const l3 = await s.create('leads', { name: 'Kiran', phone: '9876511111' });
    expect(l3.number).toBe('LD-0003'); // numbers are never reused

    const reloaded = new Store(new LocalBackend());
    await reloaded.load();
    expect(reloaded.all('leads').map((r) => r.name)).toEqual(['Ravi', 'Kiran']);
  });

  it('rejects invalid input with field errors', async () => {
    await expect(s.create('leads', { name: '', phone: 'x' })).rejects.toBeInstanceOf(ValidationError);
    try { await s.create('leads', { name: '', phone: 'x' }); } catch (e) {
      expect((e as ValidationError).errors).toHaveProperty('name');
      expect((e as ValidationError).errors).toHaveProperty('phone');
    }
    expect(s.all('leads')).toHaveLength(0);
  });

  it('detects duplicates across phone formats and allows override', async () => {
    await s.create('leads', { name: 'Ravi', phone: '9876543210' });
    await expect(s.create('leads', { name: 'R', phone: '+91 98765-43210' })).rejects.toBeInstanceOf(DuplicateError);
    await s.create('leads', { name: 'R', phone: '+91 98765-43210' }, { allowDuplicate: true });
    expect(s.all('leads')).toHaveLength(2);
  });

  it('does not flag a record as a duplicate of itself on update', async () => {
    const l = await s.create('leads', { name: 'Ravi', phone: '9876543210' });
    await s.update('leads', l.id, { city: 'Patna' });
    expect(s.get('leads', l.id)?.city).toBe('Patna');
  });

  it('auto-assigns leads to the sales user with fewest open leads', async () => {
    s.users = [
      ...s.users,
      { id: 's1', name: 'S1', email: 's1@x', role: 'sales', active: true },
      { id: 's2', name: 'S2', email: 's2@x', role: 'sales', active: true },
    ];
    const a = await s.create('leads', { name: 'A', phone: '9000000001' });
    const b = await s.create('leads', { name: 'B', phone: '9000000002' });
    expect(new Set([a.assignedTo, b.assignedTo])).toEqual(new Set(['s1', 's2']));
  });

  it('converts a won lead into a customer once, reusing an existing customer', async () => {
    const c = await s.create('customers', { name: 'Ravi', phone: '9876543210' });
    const l = await s.create('leads', { name: 'Ravi K', phone: '09876543210' });
    await s.update('leads', l.id, { status: 'Won' });
    expect(s.all('customers')).toHaveLength(1);
    expect(s.get('leads', l.id)?.customerId).toBe(c.id);
    await s.update('leads', l.id, { status: 'Won', notes: 'again' });
    expect(s.all('customers')).toHaveLength(1);
  });

  it('blocks deleting records that others depend on', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9876543210' });
    await s.create('projects', { name: 'P', customerId: c.id });
    await expect(s.remove('customers', c.id)).rejects.toThrow(/used by 1 project/);
  });

  it('rejects refs to missing records', async () => {
    await expect(s.create('projects', { name: 'P', customerId: 'ghost' })).rejects.toThrow(/no longer exists/);
  });

  it('tracks stock and blocks over-dispatch, including on edit', async () => {
    const p = await s.create('products', { name: 'Panel', sku: 'P1', reorderLevel: 5 });
    await s.create('stockMoves', { productId: p.id, direction: 'In', qty: 10, date: '2026-01-01' });
    const out = await s.create('stockMoves', { productId: p.id, direction: 'Out', qty: 4, date: '2026-01-02' });
    expect(s.stockOf(p.id)).toBe(6);
    await expect(s.create('stockMoves', { productId: p.id, direction: 'Out', qty: 7, date: '2026-01-03' })).rejects.toThrow(/Only 6/);
    await s.update('stockMoves', out.id, { qty: 10 }); // editing own record excludes itself
    expect(s.stockOf(p.id)).toBe(0);
    expect(computeAlerts(s, '2026-01-05').some((a) => a.text.startsWith('Low stock'))).toBe(true);
  });

  it('derives payment status from payments and prevents overpayment', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9876543210' });
    const inv = await s.create('invoices', { customerId: c.id, date: '2026-05-01', items: [item(1000)], status: 'Sent' });
    expect(inv.number).toBe('INV/26-27/0001');
    expect(inv.dueDate).toBe('2026-05-16'); // default payment terms
    expect(s.computed('invoices', inv).balance).toBe(1000);
    expect(s.paymentStatus(inv)).toBe('Unpaid');
    const p1 = await s.create('payments', { invoiceId: inv.id, date: '2026-05-02', amount: 400 });
    expect(s.paymentStatus(s.get('invoices', inv.id)!)).toBe('Partially Paid');
    await expect(s.create('payments', { invoiceId: inv.id, date: '2026-05-02', amount: 601 })).rejects.toThrow(/more than the balance/);
    await s.create('payments', { invoiceId: inv.id, date: '2026-05-03', amount: 600 });
    expect(s.paymentStatus(s.get('invoices', inv.id)!)).toBe('Paid');
    await s.remove('payments', p1.id);
    expect(s.paymentStatus(s.get('invoices', inv.id)!)).toBe('Partially Paid');
    await expect(s.update('invoices', inv.id, { items: [item(100)] })).rejects.toThrow(/cannot be less/);
    await expect(s.update('invoices', inv.id, { status: 'Cancelled' })).rejects.toThrow(/Delete the payments/);
    await expect(s.remove('invoices', inv.id)).rejects.toThrow(/cannot be deleted/);
  });

  it('a payment on a draft invoice marks it as sent', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9876543210' });
    const inv = await s.create('invoices', { customerId: c.id, date: '2026-05-01', items: [item(500)] });
    expect(inv.status).toBe('Draft');
    await s.create('payments', { invoiceId: inv.id, date: '2026-05-02', amount: 100 });
    expect(s.get('invoices', inv.id)?.status).toBe('Sent');
  });

  it('uses IGST when customer state differs from company state', async () => {
    await s.saveSettings({ state: 'Bihar' });
    const local = await s.create('customers', { name: 'L', phone: '9000000001', state: 'bihar ' });
    const far = await s.create('customers', { name: 'F', phone: '9000000002', state: 'Delhi' });
    const q = (cid: string) => ({ customerId: cid, items: [item(100, 1, 18)] } as unknown as Rec);
    expect(s.totalsFor('invoices', q(local.id)).igst).toBe(0);
    expect(s.totalsFor('invoices', q(far.id)).igst).toBe(18);
  });

  it('freezes place of supply and tax type on saved invoices', async () => {
    await s.saveSettings({ state: 'Bihar' });
    const far = await s.create('customers', { name: 'F', phone: '9000000002', state: 'Delhi' });
    const inv = await s.create('invoices', { customerId: far.id, date: '2026-05-01', items: [item(100, 1, 18)] });
    expect(inv.placeOfSupply).toBe('Delhi');
    expect(inv.interState).toBe(true);
    await s.update('customers', far.id, { state: 'Bihar' });
    expect(s.totalsFor('invoices', s.get('invoices', inv.id)!).igst).toBe(18); // unchanged
  });

  it('fills state from GSTIN and rejects a mismatch', async () => {
    const c = await s.create('customers', { name: 'G', phone: '9000000003', gstin: '10AAKCN0009K1ZW' });
    expect(c.state).toBe('Bihar');
    await expect(s.create('customers', { name: 'H', phone: '9000000004', gstin: '07AAKCN0009K1ZW', state: 'Bihar' })).rejects.toThrow(/registered in Delhi/);
  });

  it('numbers invoices per financial year and blocks moving one across years', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9876543210' });
    const a = await s.create('invoices', { customerId: c.id, date: '2026-03-31', status: 'Sent', items: [item(1)] });
    const b = await s.create('invoices', { customerId: c.id, date: '2026-04-01', status: 'Sent', items: [item(1)] });
    const d = await s.create('invoices', { customerId: c.id, date: '2026-04-02', status: 'Sent', items: [item(1)] });
    expect([a.number, b.number, d.number]).toEqual(['INV/25-26/0001', 'INV/26-27/0001', 'INV/26-27/0002']);
    await expect(s.update('invoices', a.id, { date: '2026-04-05' })).rejects.toThrow(/another financial year/);
    await expect(s.update('invoices', a.id, { date: '2026-03-01' })).rejects.toThrow(/date can no longer be changed/); // issued
    const q = await s.create('quotations', { customerId: c.id, date: '2026-03-31', items: [item(1)] });
    await expect(s.update('quotations', q.id, { date: '2026-04-05' })).rejects.toThrow(/another financial year/);
    await s.update('quotations', q.id, { date: '2026-03-01' }); // same year: fine
  });

  it('a draft invoice has no number until it is issued, so drafts never leave gaps in the series', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9876543210' });
    const first = await s.create('invoices', { customerId: c.id, date: '2026-05-01', status: 'Sent', items: [item(1)] });
    const draft = await s.create('invoices', { customerId: c.id, date: '2026-05-02', items: [item(1)] });
    const dropped = await s.create('invoices', { customerId: c.id, date: '2026-05-03', items: [item(1)] });
    expect(draft.number).toBeUndefined();
    expect(s.titleOf('invoices', draft.id)).toBe('Draft invoice of 02 May 2026');
    await s.update('invoices', dropped.id, { status: 'Cancelled' }); // never issued: still no number
    expect(s.get('invoices', dropped.id)?.number).toBeUndefined();
    await s.update('invoices', draft.id, { status: 'Sent' }); // issued now: the next number
    expect([first.number, s.get('invoices', draft.id)?.number]).toEqual(['INV/26-27/0001', 'INV/26-27/0002']);
    await s.update('invoices', draft.id, { notes: 'x' }); // keeps it
    expect(s.get('invoices', draft.id)?.number).toBe('INV/26-27/0002');
    // A payment on a draft issues it (and numbers it).
    const d2 = await s.create('invoices', { customerId: c.id, date: '2026-05-04', items: [item(100)] });
    await s.create('payments', { invoiceId: d2.id, date: '2026-05-05', amount: 50, mode: 'UPI' });
    expect(s.get('invoices', d2.id)).toMatchObject({ status: 'Sent', number: 'INV/26-27/0003' });
  });

  it('an older database that does not number on issue: the invoice stays a draft and the admin is told to update it', async () => {
    const b = new LocalBackend();
    const admin = await b.signIn('admin@example.com', 'password123');
    const plain = b.update.bind(b);
    b.update = (entity, rec) => plain(entity, rec); // drops the numbering request, as the old schema did
    const old = new Store(b);
    old.user = admin;
    await old.load();
    const c = await old.create('customers', { name: 'C', phone: '9876543211' });
    const draft = await old.create('invoices', { customerId: c.id, date: '2026-05-02', items: [item(1)] });
    await expect(old.update('invoices', draft.id, { status: 'Sent' })).rejects.toThrow(/left as a draft.*schema\.sql/);
    expect(old.get('invoices', draft.id)).toMatchObject({ status: 'Draft' });
    expect(old.get('invoices', draft.id)?.number).toBeUndefined();
  });

  it('PM Surya Ghar: system size from the project, subsidy from the scheme slabs; a typed amount is kept', async () => {
    const c = await s.create('customers', { name: 'Home', phone: '9876543299', state: 'Bihar' });
    await s.create('projects', { name: 'Roof', customerId: c.id, capacityKw: 2.5 });
    const a = await s.create('subsidies', { customerId: c.id, scheme: 'PM Surya Ghar' });
    expect(a).toMatchObject({ capacityKw: 2.5, amount: 69000 }); // 2 × 30,000 + 0.5 × 18,000
    const big = await s.create('subsidies', { customerId: c.id, scheme: 'PM Surya Ghar', capacityKw: 10 });
    expect(big.amount).toBe(78000); // capped at 3 kW
    const rwa = await s.create('subsidies', { customerId: c.id, scheme: 'PM Surya Ghar', capacityKw: 50, amount: 900000 });
    expect(rwa.amount).toBe(900000); // housing society: typed amount kept
    const other = await s.create('subsidies', { customerId: c.id, scheme: 'State scheme' });
    expect(other.amount).toBeUndefined();
  });

  it('detects edits that conflict with another tab or user', async () => {
    const l = await s.create('leads', { name: 'V', phone: '9000000010' });
    const other = new Store(new LocalBackend());
    await other.load();
    await other.update('leads', l.id, { city: 'Gaya' });
    await expect(s.update('leads', l.id, { city: 'Patna' })).rejects.toBeInstanceOf(ConflictError);
    expect(s.get('leads', l.id)?.city).toBe('Gaya'); // reloaded their version
    await s.update('leads', l.id, { city: 'Patna' }); // second save is deliberate
    expect(s.get('leads', l.id)?.version).toBe(3);
  });

  it('applies remote changes by version', async () => {
    const l = await s.create('leads', { name: 'R', phone: '9000000011' });
    s.applyRemote({ kind: 'upsert', entity: 'leads', rec: { ...l, city: 'Old', version: 0 } });
    expect(s.get('leads', l.id)?.city).toBeUndefined();
    s.applyRemote({ kind: 'upsert', entity: 'leads', rec: { ...l, city: 'New', version: 5 } });
    expect(s.get('leads', l.id)?.city).toBe('New');
    s.applyRemote({ kind: 'delete', id: l.id });
    expect(s.get('leads', l.id)).toBeUndefined();
  });

  it('a failed save does not use up a document number', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9876543210' });
    // The device's record store refuses the write (full).
    const proto = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (...a: unknown[]) => unknown } } }).IDBObjectStore.prototype;
    const realPut = proto.put;
    proto.put = function (this: unknown, v: unknown, k: unknown) {
      if (k === 'ss1:data:quotations') throw new DOMException('full', 'QuotaExceededError');
      return realPut.call(this, v, k);
    };
    await expect(s.create('quotations', { customerId: c.id, date: '2026-05-01', items: [item(1)] })).rejects.toThrow(/storage is full/);
    proto.put = realPut;
    const q = await s.create('quotations', { customerId: c.id, date: '2026-05-01', items: [item(1)] });
    expect(q.number).toBe('QT/26-27/0001');
  });

  it('stock cannot go negative by editing or deleting an inward entry', async () => {
    const p = await s.create('products', { name: 'Inv', sku: 'I1' });
    const inMove = await s.create('stockMoves', { productId: p.id, direction: 'In', qty: 100, date: '2026-01-01' });
    await s.create('stockMoves', { productId: p.id, direction: 'Out', qty: 80, date: '2026-01-02' });
    await expect(s.update('stockMoves', inMove.id, { qty: 10 })).rejects.toThrow(/negative/);
    const p2 = await s.create('products', { name: 'Other', sku: 'I2' });
    await expect(s.update('stockMoves', inMove.id, { productId: p2.id })).rejects.toThrow(/previous product/);
    await expect(s.remove('stockMoves', inMove.id)).rejects.toThrow(/negative/);
  });

  it('receiving a purchase order adds stock exactly once', async () => {
    const v = await s.create('vendors', { name: 'V' });
    const p = await s.create('products', { name: 'Panel', sku: 'PP' });
    const po = await s.create('purchaseOrders', { vendorId: v.id, date: '2026-05-01', items: [{ ...item(10, 5), productId: p.id }, item(3)] });
    await s.update('purchaseOrders', po.id, { status: 'Received' });
    expect(s.stockOf(p.id)).toBe(5);
    expect(s.get('purchaseOrders', po.id)?.stockReceived).toBe(true);
    await expect(s.update('purchaseOrders', po.id, { status: 'Ordered' })).rejects.toThrow(/already received/);
    await expect(s.update('purchaseOrders', po.id, { items: [{ ...item(10, 50), productId: p.id }] })).rejects.toThrow(/can no longer be changed/);
    await s.update('purchaseOrders', po.id, { notes: 'checked' });
    expect(s.stockOf(p.id)).toBe(5);
  });

  it('a quotation can only be converted to an invoice once', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9876543210' });
    const q = await s.create('quotations', { customerId: c.id, date: '2026-05-01', items: [item(10)] });
    const inv = await s.quotationToInvoice(q.id);
    expect(s.get('quotations', q.id)?.invoiceId).toBe(inv.id);
    await expect(s.quotationToInvoice(q.id)).rejects.toThrow(/already converted/);
  });

  it('a failed follow-up step is a warning, not a failed save', async () => {
    const warnings: string[] = [];
    s.onWarning = (m) => warnings.push(m);
    const l = await s.create('leads', { name: 'W', phone: '9000000012' });
    const realCreate = s.create.bind(s);
    s.create = (async (e: string, d: Record<string, unknown>, o?: object) => {
      if (e === 'customers') throw new Error('boom');
      return realCreate(e, d, o);
    }) as typeof s.create;
    const saved = await s.update('leads', l.id, { status: 'Won' });
    expect(saved.status).toBe('Won');
    expect(warnings.join()).toMatch(/customer could not be created.*boom/);
  });

  it('device-mode recovery code resets the admin password once', async () => {
    localStorage.clear();
    const b = new LocalBackend();
    const { recoveryCode } = await b.setupAdmin('A', 'a@x.com', 'password123', '9876543210');
    expect(recoveryCode).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    await b.signOut();
    await expect(b.recoverWithCode('a@x.com', 'WRONG-CODE1', 'newpassword1')).rejects.toThrow(/not valid/);
    const r = await b.recoverWithCode('a@x.com', recoveryCode!.toLowerCase().replace('-', ' '), 'newpassword1');
    expect(r.recoveryCode).not.toBe(recoveryCode);
    await b.signOut();
    await b.signIn('a@x.com', 'newpassword1');
    await expect(b.recoverWithCode('a@x.com', recoveryCode!, 'another123')).rejects.toThrow(/not valid/); // old code is spent
  });

  it('converts a quotation into a draft invoice', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9876543210' });
    const q = await s.create('quotations', { customerId: c.id, date: '2026-01-01', items: [item(500, 2, 12)], discount: 100 });
    const inv = await s.quotationToInvoice(q.id);
    expect(inv.status).toBe('Draft');
    expect(s.computed('invoices', inv).grandTotal).toBe(s.computed('quotations', q).grandTotal);
    expect(s.get('quotations', q.id)?.status).toBe('Accepted');
  });

  it('export / restore round-trips data and counters', async () => {
    await s.create('leads', { name: 'A', phone: '9000000001' });
    const dump = s.exportAll();
    await s.create('leads', { name: 'B', phone: '9000000002' });
    await s.replaceAll(dump);
    expect(s.all('leads').map((l) => l.name)).toEqual(['A']);
    const c = await s.create('leads', { name: 'C', phone: '9000000003' });
    expect(c.number).toBe('LD-0003'); // LD-0002 was already given out: a restore never hands a number out twice
  });

  it('raises alerts for overdue items', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9876543210' });
    await s.create('leads', { name: 'Late', phone: '9000000009', nextFollowUp: '2026-01-01T10:00' });
    await s.create('amcs', { customerId: c.id, startDate: '2025-01-01', endDate: '2026-01-20' });
    await s.create('invoices', { customerId: c.id, date: '2025-12-01', dueDate: '2025-12-15', items: [item(10)], status: 'Sent' });
    s.users = [...s.users, { id: 's9', name: 'S', email: 's@x', role: 'sales', active: true }];
    await s.saveSettings({ autoAssignLeads: false });
    await s.create('leads', { name: 'Nobody', phone: '9000000013' });
    const texts = computeAlerts(s, '2026-01-05').map((a) => a.text);
    expect(texts).toContain('Unassigned new lead: Nobody');
    expect(texts).toEqual(expect.arrayContaining([
      'Follow-up overdue: Late',
      expect.stringMatching(/^AMC renewal due/),
      expect.stringMatching(/^Payment overdue/),
    ]));
  });

  it('a form opened before someone else saved cannot silently overwrite their change', async () => {
    const l = await s.create('leads', { name: 'Shared', phone: '9000000020' });
    const openedAt = s.get('leads', l.id)!.version;
    await s.update('leads', l.id, { status: 'Won' }); // another user (cache already updated by realtime)
    await expect(s.update('leads', l.id, { notes: 'mine' }, { expectedVersion: openedAt })).rejects.toBeInstanceOf(ConflictError);
    expect(s.get('leads', l.id)?.status).toBe('Won');
    // Deliberate second save applies only the changed field on top of their version.
    await s.update('leads', l.id, { notes: 'mine' }, { expectedVersion: s.get('leads', l.id)!.version });
    expect(s.get('leads', l.id)).toMatchObject({ status: 'Won', notes: 'mine' });
  });

  it('automatic re-saves never change an issued invoice\'s tax type; a draft takes the tax type that applies when issued', async () => {
    const c = await s.create('customers', { name: 'Far', phone: '9000000021', state: 'Delhi' });
    const inv = await s.create('invoices', { customerId: c.id, date: '2026-05-01', status: 'Sent', items: [item(100, 1, 18)] });
    expect(inv.interState).toBe(false); // company state not set yet → CGST+SGST
    const draft = await s.create('invoices', { customerId: c.id, date: '2026-05-01', items: [item(100, 1, 18)] });
    await s.saveSettings({ state: 'Bihar' });
    await s.create('payments', { invoiceId: inv.id, date: '2026-05-02', amount: 10 }); // re-saves the invoice
    expect(s.get('invoices', inv.id)).toMatchObject({ status: 'Sent', interState: false });
    await expect(s.update('invoices', inv.id, { placeOfSupply: 'Haryana' })).rejects.toThrow(/place of supply/); // issued: locked
    await s.update('invoices', draft.id, s.issuePatch(s.get('invoices', draft.id)!, '2026-05-01'));
    expect(s.get('invoices', draft.id)).toMatchObject({ status: 'Sent', interState: true }); // Bihar → Delhi: IGST
  });

  it('company settings can be saved repeatedly from the same screen', async () => {
    const form = s.settings();
    await s.saveSettings({ ...form, companyName: 'One' });
    await s.saveSettings({ ...form, companyName: 'Two' }); // stale id/version in the form must not matter
    expect(s.settings().companyName).toBe('Two');
  });

  it('refuses writes the role does not allow with a clear message', async () => {
    s.user = { ...s.user!, role: 'technician' };
    await expect(s.create('invoices', { customerId: 'x', date: '2026-01-01', items: [item(1)] })).rejects.toThrow(/access rights do not allow changing invoices/);
  });

  it('device mode never reuses a number even if the counter failed to save', async () => {
    await s.create('leads', { name: 'A', phone: '9000000030' });
    localStorage.setItem('ss1:counters', '{}'); // counter lost, record kept
    const b = await s.create('leads', { name: 'B', phone: '9000000031' });
    expect(b.number).toBe('LD-0002');
  });

  it('a knowingly saved duplicate does not ask again on unrelated edits', async () => {
    await s.create('leads', { name: 'First', phone: '9000000040' });
    const dup = await s.create('leads', { name: 'Second', phone: '9000000040' }, { allowDuplicate: true });
    await s.update('leads', dup.id, { status: 'Won' }); // no DuplicateError
    await expect(s.update('leads', dup.id, { phone: '+91 9000000040 ' })).resolves.toBeTruthy(); // same number, other format
    await s.create('leads', { name: 'Third', phone: '9000000041' });
    await expect(s.update('leads', dup.id, { phone: '9000000041' })).rejects.toBeInstanceOf(DuplicateError); // changed to a taken number
  });
});

describe('delivery challans, purchase GST and line discounts', () => {
  let s: Store;
  beforeEach(async () => { localStorage.clear(); s = await freshStore(); });

  async function setup() {
    const c = await s.create('customers', { name: 'Ravi', phone: '9876543210', state: 'Bihar' });
    const pr = await s.create('projects', { name: 'Ravi 5 kW', customerId: c.id });
    const panel = await s.create('products', { name: 'Panel 545 Wp', sku: 'P545', category: 'Solar Panel', price: 15000, cost: 12000, gstRate: '12' });
    const labour = await s.create('products', { name: 'Installation', sku: 'SRV', category: 'Service', price: 5000 });
    await s.create('stockMoves', { productId: panel.id, direction: 'In', qty: 10, date: '2026-05-01' });
    return { c, pr, panel, labour };
  }
  const line = (productId: string, qty: number, rate = 100) => ({ productId, description: 'x', qty, rate, gstRate: 12 });

  it('dispatching takes stock out once, adds up repeated lines, skips services, and cancelling puts it back', async () => {
    const { c, pr, panel, labour } = await setup();
    const dc = await s.create('dispatches', { projectId: pr.id, date: '2026-05-02', items: [line(panel.id, 4), line(panel.id, 2), line(labour.id, 1)] });
    expect(dc.number).toMatch(/^DC\/26-27\/0001$/);
    expect(dc.customerId).toBe(c.id); // taken from the project
    expect(s.stockOf(panel.id)).toBe(10);
    await s.update('dispatches', dc.id, { status: 'Dispatched' });
    expect(s.stockOf(panel.id)).toBe(4);
    expect(s.all('stockMoves').filter((m) => m.direction === 'Out')).toHaveLength(1);
    await s.update('dispatches', dc.id, { status: 'Delivered' });
    expect(s.stockOf(panel.id)).toBe(4);
    await expect(s.update('dispatches', dc.id, { items: [line(panel.id, 1)] })).rejects.toThrow(/already taken out/);
    await s.update('dispatches', dc.id, { status: 'Cancelled' });
    expect(s.stockOf(panel.id)).toBe(10);
    await expect(s.update('dispatches', dc.id, { status: 'Dispatched' })).rejects.toThrow(/cannot be reopened/);
    expect(s.stockOf(panel.id)).toBe(10);
  });

  it('refuses to dispatch more than is in stock', async () => {
    const { pr, panel } = await setup();
    await expect(s.create('dispatches', { projectId: pr.id, date: '2026-05-02', status: 'Dispatched', items: [line(panel.id, 7), line(panel.id, 4)] }))
      .rejects.toThrow(/Not enough stock: Panel 545 Wp \(need 11, have 10\)/);
    expect(s.stockOf(panel.id)).toBe(10);
  });

  it('purchase orders charge IGST for an out-of-state vendor and CGST+SGST for a local one', async () => {
    await s.saveSettings({ state: 'Bihar' });
    const far = await s.create('vendors', { name: 'Far', gstin: '24AAAAA0000A1Z5' });
    const near = await s.create('vendors', { name: 'Near', state: 'Bihar' });
    const items = [{ description: 'Inverter', qty: 1, rate: 10000, gstRate: 18 }];
    const a = await s.create('purchaseOrders', { vendorId: far.id, date: '2026-05-01', items });
    const b = await s.create('purchaseOrders', { vendorId: near.id, date: '2026-05-01', items });
    expect(s.get('vendors', far.id)?.state).toBe('Gujarat');
    expect(s.totalsFor('purchaseOrders', a)).toMatchObject({ igst: 1800, cgst: 0, grandTotal: 11800 });
    expect(s.totalsFor('purchaseOrders', b)).toMatchObject({ igst: 0, cgst: 900, sgst: 900, grandTotal: 11800 });
  });

  it('line discounts reduce the taxable value and are validated', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9876543211' });
    const q = await s.create('quotations', { customerId: c.id, date: '2026-05-01', items: [{ description: 'Panel', qty: 2, rate: 1000, discountPct: 10, gstRate: 12 }] });
    expect(s.totalsFor('quotations', q)).toMatchObject({ gross: 2000, lineDiscount: 200, subtotal: 1800, taxable: 1800, cgst: 108, sgst: 108, grandTotal: 2016 });
    await expect(s.create('quotations', { customerId: c.id, date: '2026-05-01', items: [{ description: 'P', qty: 1, rate: 1, discountPct: 120, gstRate: 0 }] }))
      .rejects.toThrow(/between 0 and 100/);
  });

  it('rejects a bad PIN code', async () => {
    await expect(s.create('customers', { name: 'P', phone: '9876543219', pincode: '12345' })).rejects.toThrow(/6 digits/);
    const ok = await s.create('customers', { name: 'P', phone: '9876543219', pincode: ' 800 001 ' });
    expect(ok.pincode).toBe('800001');
  });
});
