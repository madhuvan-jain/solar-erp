// Bugs found in the third full review, each with the case that used to go wrong.
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalBackend } from './local';
import { Store } from './store';
import { filtersFor } from '../../modules/filters';
import { getEntity } from '../../modules/registry';

const line = (rate: number, qty = 1, gstRate = 18, extra: Record<string, unknown> = {}) => ({ description: 'Item', qty, rate, gstRate, ...extra });

describe('third review fixes', () => {
  let s: Store;
  beforeEach(async () => {
    localStorage.clear();
    const b = new LocalBackend();
    const { user } = await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    s = new Store(b); s.user = user; await s.load();
  });

  it('an issued invoice is locked: no back to Draft, a cancelled one stays cancelled, lines/customer/date fixed; notes still editable', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9000000101' });
    const c2 = await s.create('customers', { name: 'D', phone: '9000000102' });
    const inv = await s.create('invoices', { customerId: c.id, date: '2026-05-01', status: 'Sent', items: [line(1000)] });
    await expect(s.update('invoices', inv.id, { status: 'Draft' })).rejects.toThrow(/cannot go back to Draft/);
    await expect(s.update('invoices', inv.id, { items: [line(900)] })).rejects.toThrow(/lines and price/);
    await expect(s.update('invoices', inv.id, { discount: 100 })).rejects.toThrow(/lines and price/);
    await expect(s.update('invoices', inv.id, { customerId: c2.id })).rejects.toThrow(/customer/);
    await s.update('invoices', inv.id, { notes: 'Sent by email', items: [{ ...line(1000), unit: 'Nos' }] }); // same lines, other layout
    await s.update('invoices', inv.id, { status: 'Cancelled' });
    await expect(s.update('invoices', inv.id, { status: 'Sent' })).rejects.toThrow(/cancelled invoice cannot be used again/);
  });

  it('issuing an old draft gives it the issue date (due date moves with it); a payment issues it on the payment date', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9000000103' });
    const d = await s.create('invoices', { customerId: c.id, date: '2026-09-01', dueDate: '2026-09-16', items: [line(1000)] });
    expect(s.issuePatch(d, '2026-11-12')).toEqual({ status: 'Sent', date: '2026-11-12', dueDate: '2026-11-27' });
    expect(s.issuePatch({ ...d, date: '2026-11-20' }, '2026-11-12')).toEqual({ status: 'Sent' }); // dated ahead: kept
    await s.create('payments', { invoiceId: d.id, date: '2026-10-05', amount: 100, mode: 'UPI' });
    expect(s.get('invoices', d.id)).toMatchObject({ status: 'Sent', date: '2026-10-05', dueDate: '2026-10-20' });
  });

  it('overdue and due-soon filters leave drafts out', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9000000104' });
    const draft = await s.create('invoices', { customerId: c.id, date: '2026-01-01', dueDate: '2026-01-16', items: [line(1000)] });
    const sent = await s.create('invoices', { customerId: c.id, date: '2026-01-01', dueDate: '2026-01-16', status: 'Sent', items: [line(1000)] });
    const over = filtersFor(getEntity('invoices')!).find((f) => f.key === 'due:over')!;
    const ctx = { store: s, today: '2026-11-12' } as Parameters<typeof over.test>[1];
    expect([over.test(draft, ctx), over.test(sent, ctx)]).toEqual([false, true]);
  });

  it('a purchase order with supplier payments cannot be cancelled or cut below what was paid; received → discount and vendor locked', async () => {
    const v = await s.create('vendors', { name: 'V', phone: '9000000105' });
    const v2 = await s.create('vendors', { name: 'W', phone: '9000000106' });
    const p = await s.create('products', { name: 'Inverter', sku: 'I', category: 'Inverter' });
    const po = await s.create('purchaseOrders', { vendorId: v.id, date: '2026-05-01', status: 'Ordered', items: [line(100000, 1, 5, { productId: p.id })] });
    const pay = await s.create('supplierPayments', { purchaseOrderId: po.id, date: '2026-05-02', amount: 50000, mode: 'UPI' });
    await expect(s.update('purchaseOrders', po.id, { status: 'Cancelled' })).rejects.toThrow(/Delete those supplier payments/);
    await expect(s.update('purchaseOrders', po.id, { items: [line(10000, 1, 5, { productId: p.id })] })).rejects.toThrow(/already paid to the vendor/);
    await s.receiveGoods(po.id);
    await expect(s.update('purchaseOrders', po.id, { discount: 20000 })).rejects.toThrow(/discount can no longer be changed/);
    await expect(s.update('purchaseOrders', po.id, { vendorId: v2.id })).rejects.toThrow(/received from this vendor/);
    await s.update('supplierPayments', pay.id, { reference: 'UTR123' }); // still editable
  });

  it('products used on document lines cannot be deleted; a deleted product is never "received"; stock blocks turning it into a service', async () => {
    const v = await s.create('vendors', { name: 'V', phone: '9000000107' });
    const p = await s.create('products', { name: 'Inverter', sku: 'I2', category: 'Inverter' });
    const po = await s.create('purchaseOrders', { vendorId: v.id, date: '2026-05-01', status: 'Ordered', items: [line(1000, 2, 5, { productId: p.id })] });
    await expect(s.remove('products', p.id)).rejects.toThrow(/used by 1 purchase order/);
    // An order whose product disappeared (e.g. deleted by an older version, or in another tab).
    const ghost = await s.create('purchaseOrders', { vendorId: v.id, date: '2026-05-01', status: 'Ordered', items: [line(1000, 2, 5, { productId: 'gone-product' })] });
    await expect(s.receiveGoods(ghost.id)).rejects.toThrow(/was deleted/);
    expect(s.get('purchaseOrders', ghost.id)?.stockReceived).toBeFalsy();
    await s.receiveGoods(po.id);
    await expect(s.update('products', p.id, { noStock: true })).rejects.toThrow(/still in stock/);
  });

  it('challan returns go back to the warehouse the stock left from; hand entries never leave a warehouse below zero', async () => {
    const p = await s.create('products', { name: 'Panel', sku: 'P9', category: 'Solar Panel' });
    const A = await s.create('warehouses', { name: 'A' });
    const B = await s.create('warehouses', { name: 'B' });
    const inA = await s.create('stockMoves', { productId: p.id, direction: 'In', qty: 10, date: '2026-05-01', reason: 'Opening stock', warehouseId: A.id });
    const c = await s.create('customers', { name: 'C', phone: '9000000108' });
    const pr = await s.create('projects', { name: 'P1', customerId: c.id });
    const dc = await s.create('dispatches', { projectId: pr.id, date: '2026-05-03', items: [{ productId: p.id, description: 'x', qty: 4, rate: 0, gstRate: 5 }], status: 'Dispatched' });
    expect(s.stockIn(p.id, A.id)).toBe(6);
    await s.update('dispatches', dc.id, { status: 'Cancelled' });
    expect([s.stockIn(p.id, A.id), s.stockIn(p.id, '')]).toEqual([10, 0]);
    // In 10 to A, In 10 to B, Out 10 from A — then re-pointing the first entry to B would leave A at −10.
    await s.create('stockMoves', { productId: p.id, direction: 'In', qty: 10, date: '2026-05-04', reason: 'Opening stock', warehouseId: B.id });
    await s.create('stockMoves', { productId: p.id, direction: 'Out', qty: 10, date: '2026-05-05', reason: 'Other', warehouseId: A.id });
    await expect(s.update('stockMoves', inA.id, { warehouseId: B.id })).rejects.toThrow(/would leave A with -10/);
    await expect(s.remove('stockMoves', inA.id)).rejects.toThrow(/stock in A negative/);
  });

  it('PM Surya Ghar: an amount the app worked out follows the capacity; one typed in stays', async () => {
    const c = await s.create('customers', { name: 'Home', phone: '9000000109', state: 'Uttar Pradesh' });
    const sb = await s.create('subsidies', { customerId: c.id, scheme: 'PM Surya Ghar', capacityKw: 2 });
    expect(sb.amount).toBe(60000);
    await s.update('subsidies', sb.id, { capacityKw: 3 });
    expect(s.get('subsidies', sb.id)?.amount).toBe(78000);
    await s.update('subsidies', sb.id, { amount: 70000 }); // typed: kept from now on
    await s.update('subsidies', sb.id, { capacityKw: 1 });
    expect(s.get('subsidies', sb.id)?.amount).toBe(70000);
  });

  it('GST basics before issuing: a place of supply, a discount within the lines, no balance on a cancelled invoice; invoicing confirms the order', async () => {
    await s.saveSettings({ state: 'Bihar' });
    const c = await s.create('customers', { name: 'No state', phone: '9000000111' });
    const d = await s.create('invoices', { customerId: c.id, date: '2026-11-12', items: [line(1000)] });
    await expect(s.update('invoices', d.id, { status: 'Sent' })).rejects.toThrow(/place of supply/);
    await expect(s.create('payments', { invoiceId: d.id, date: '2026-11-12', amount: 100, mode: 'UPI' })).rejects.toThrow(/Issue invoice/);
    await s.update('invoices', d.id, { status: 'Sent', placeOfSupply: 'Uttar Pradesh' });
    expect(s.get('invoices', d.id)).toMatchObject({ interState: true }); // Bihar → UP: IGST
    await expect(s.create('quotations', { customerId: c.id, date: '2026-11-12', items: [line(1000)], discount: 5000 })).rejects.toThrow(/more than the value of the lines/);
    const x = await s.create('invoices', { customerId: c.id, date: '2026-11-12', items: [line(1000)] });
    await s.update('invoices', x.id, { status: 'Cancelled' });
    expect(s.computed('invoices', s.get('invoices', x.id)!).balance).toBe(0);
    const lead = await s.create('leads', { name: 'Buyer', phone: '9000000112' });
    const q = await s.create('quotations', { customerId: c.id, leadId: lead.id, date: '2026-11-12', items: [line(1000)] });
    await s.quotationToInvoice(q.id);
    expect(s.get('leads', lead.id)?.status).toBe('Won');
    expect(s.get('quotations', q.id)?.status).toBe('Accepted');
  });

  it('restores never re-issue a number; demo data in/out uses exactly the counters given', async () => {
    const a = await s.create('expenses', { description: 'A', category: 'Other', amount: 1, date: '2026-05-01' });
    const b = await s.create('expenses', { description: 'B', category: 'Other', amount: 1, date: '2026-05-01' });
    expect([a.number, b.number]).toEqual(['EX-0001', 'EX-0002']);
    const backup = s.exportAll();
    const counters = s.backend.counters!();
    await s.create('expenses', { description: 'C', category: 'Other', amount: 1, date: '2026-05-01' }); // EX-0003 given out
    await s.replaceAll(backup, { counters });
    expect((await s.create('expenses', { description: 'D', category: 'Other', amount: 1, date: '2026-05-01' })).number).toBe('EX-0004');
    // Demo removed: numbering goes back exactly to where the business was (no gap in the real series).
    await s.replaceAll(backup, { counters, keepCounters: false });
    expect((await s.create('expenses', { description: 'E', category: 'Other', amount: 1, date: '2026-05-01' })).number).toBe('EX-0003');
  });
});

describe('two tabs on one device', () => {
  it('a tab whose device session was switched by another tab counts as signed out (it never writes elsewhere)', async () => {
    localStorage.clear();
    const tabA = new LocalBackend();
    const { user: admin } = await tabA.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    await tabA.saveUser({ id: 'u2', name: 'Second', email: 'two@example.com', phone: '9876500002', role: 'sales', active: true }, 'password123');
    expect((await tabA.currentUser())?.id).toBe(admin.id);
    const tabB = new LocalBackend();
    await tabB.signOut();
    await tabB.signIn('two@example.com', 'password123');
    expect((await tabB.currentUser())?.id).toBe('u2');
    expect(await tabA.currentUser()).toBeNull(); // tab A must not act as someone else (or in another business)
    await expect(tabA.saveUser({ id: 'u3', name: 'X', email: 'x@example.com', phone: '9876500003', role: 'sales', active: true }, 'password123')).rejects.toThrow();
  });
});
