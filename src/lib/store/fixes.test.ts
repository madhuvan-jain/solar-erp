// Bugs found in the A–Z review, each with the case that used to go wrong.
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalBackend } from './local';
import { Store } from './store';
import { valuation } from './stock';
import { renumberByYear } from '../demo';
import { itemRows, itemSeries, solarTemplate, total, type DashItem } from '../dashboards';
import type { Rec } from '../schema';

const line = (rate: number, qty = 1, gstRate = 18, extra: Record<string, unknown> = {}) => ({ description: 'Item', qty, rate, gstRate, ...extra });

describe('A–Z review fixes', () => {
  let s: Store;
  beforeEach(async () => {
    localStorage.clear();
    const b = new LocalBackend();
    const { user } = await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    s = new Store(b); s.user = user; await s.load();
  });

  it('company state comes from the GSTIN when not entered, so a Karnataka customer gets IGST; a contradicting state is refused', async () => {
    await s.saveSettings({ gstin: '10AAKCN0009K1ZW' }); // Bihar
    expect(s.companyState()).toBe('Bihar');
    const c = await s.create('customers', { name: 'K', phone: '9000000001', state: 'Karnataka' });
    const inv = await s.create('invoices', { customerId: c.id, date: '2026-05-01', items: [line(1000)] });
    expect(s.totalsFor('invoices', inv)).toMatchObject({ igst: 180, cgst: 0, sgst: 0 });
    await expect(s.saveSettings({ state: 'Maharashtra' })).rejects.toThrow(/registered in Bihar/);
  });

  it('a cancelled invoice frees its quotation: it can be edited and invoiced again', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9000000002' });
    const q = await s.create('quotations', { customerId: c.id, date: '2026-05-01', items: [line(100)] });
    const inv = await s.quotationToInvoice(q.id);
    await s.update('invoices', inv.id, { status: 'Cancelled' });
    await s.update('quotations', q.id, { items: [line(90)] });
    const again = await s.quotationToInvoice(q.id);
    expect(again.id).not.toBe(inv.id);
  });

  it('purchase orders: the order discount lowers the stock cost; a deleted default warehouse is ignored; receiving nothing changes nothing', async () => {
    const p = await s.create('products', { name: 'Panel', sku: 'P', category: 'Solar Panel' });
    const v = await s.create('vendors', { name: 'V' });
    const w = await s.create('warehouses', { name: 'Old store' });
    await s.saveSettings({ defaultWarehouse: w.id });
    await s.remove('warehouses', w.id);
    const po = await s.create('purchaseOrders', { vendorId: v.id, date: '2026-05-01', status: 'Ordered', items: [line(100, 10, 18, { productId: p.id })], discount: 500 });
    await expect(s.receiveGoods(po.id, { [p.id]: 0 })).resolves.toBe(0);
    expect(s.get('purchaseOrders', po.id)?.status).toBe('Ordered');
    await s.update('purchaseOrders', po.id, { status: 'Received' });
    expect(s.stockOf(p.id)).toBe(10);
    expect(s.stockValuation(p.id)).toEqual({ qty: 10, value: 500, avg: 50 });
    expect(s.movesFrom(po.id)[0].warehouseId).toBe('');
  });

  it('a receipt that fails puts the order back to its earlier status, so it can be received again', async () => {
    const p = await s.create('products', { name: 'Panel', sku: 'P', category: 'Solar Panel' });
    const v = await s.create('vendors', { name: 'V' });
    const po = await s.create('purchaseOrders', { vendorId: v.id, date: '2026-05-01', status: 'Ordered', items: [line(100, 2, 18, { productId: p.id })] });
    const warnings: string[] = [];
    s.onWarning = (m) => warnings.push(m);
    const real = s.create.bind(s);
    s.create = (async (e: string, d: Record<string, unknown>, o?: object) => { if (e === 'stockMoves') throw new Error('disk full'); return real(e, d, o); }) as typeof s.create;
    await s.update('purchaseOrders', po.id, { status: 'Received' });
    s.create = real;
    expect(s.get('purchaseOrders', po.id)).toMatchObject({ status: 'Ordered', stockReceived: false });
    expect(warnings.join()).toMatch(/disk full/);
    await s.receiveGoods(po.id);
    expect(s.stockOf(p.id)).toBe(2);
  });

  it('a challan whose stock cannot be taken out is put back as it was (no half-issued challan)', async () => {
    const p = await s.create('products', { name: 'Panel', sku: 'P', category: 'Solar Panel' });
    const q = await s.create('products', { name: 'Inverter', sku: 'I', category: 'Inverter' });
    await s.create('stockMoves', { productId: p.id, direction: 'In', qty: 5, date: '2026-05-01', reason: 'Opening stock' });
    await s.create('stockMoves', { productId: q.id, direction: 'In', qty: 5, date: '2026-05-01', reason: 'Opening stock' });
    const c = await s.create('customers', { name: 'C', phone: '9000000003' });
    const pr = await s.create('projects', { name: 'P1', customerId: c.id });
    s.onWarning = () => {};
    const real = s.create.bind(s);
    let n = 0;
    s.create = (async (e: string, d: Record<string, unknown>, o?: object) => { if (e === 'stockMoves' && ++n === 2) throw new Error('boom'); return real(e, d, o); }) as typeof s.create;
    const dc = await s.create('dispatches', { projectId: pr.id, date: '2026-05-02', items: [line(0, 2, 18, { productId: p.id }), line(0, 1, 18, { productId: q.id })], status: 'Dispatched' });
    s.create = real;
    expect(s.get('dispatches', dc.id)).toMatchObject({ status: 'Draft', stockIssued: false });
    expect(s.stockOf(p.id)).toBe(5);
    expect(s.movesFrom(dc.id)).toHaveLength(0);
  });

  it('stock value keeps an issue dated before its receipt', () => {
    const m = (direction: string, qty: number, date: string, rate?: number) => ({ id: date + direction, createdAt: date, updatedAt: date, direction, qty, date, rate }) as Rec;
    expect(valuation([m('In', 10, '2026-11-10', 100), m('Out', 4, '2026-11-05', 100)], 100)).toEqual({ qty: 6, value: 600, avg: 100 });
  });

  it('payment terms of 0 days mean due on the invoice date', async () => {
    await s.saveSettings({ paymentTermsDays: 0 });
    const c = await s.create('customers', { name: 'C', phone: '9000000004' });
    const inv = await s.create('invoices', { customerId: c.id, date: '2026-05-01', items: [line(100)] });
    expect(inv.dueDate).toBe('2026-05-01');
  });

  it('demo documents moved into another financial year get that year\'s numbers', () => {
    const d = (id: string, date: string, seq: number) => ({ id, createdAt: date, updatedAt: date, date, number: `INV/25-26/000${seq}`, _numKey: 'invoices:25-26', _seq: seq }) as Rec;
    const out = renumberByYear({ invoices: [d('a', '2026-03-20', 1), d('b', '2026-04-03', 2), d('c', '2026-04-10', 3)] });
    expect(out.invoices.map((r) => r.number)).toEqual(['INV/25-26/0001', 'INV/26-27/0001', 'INV/26-27/0002']);
    expect(out.invoices[2]._numKey).toBe('invoices:26-27');
  });

  it('dashboards: the template counts issued invoices only, and averages with a split divide per cell', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9000000005' });
    await s.create('invoices', { customerId: c.id, date: '2026-05-01', status: 'Draft', items: [line(1000, 1, 18)] });
    await s.create('invoices', { customerId: c.id, date: '2026-05-01', status: 'Draft', items: [line(300, 1, 0)] });
    await s.create('invoices', { customerId: c.id, date: '2026-05-01', status: 'Sent', items: [line(100, 1, 0)] });
    const invoiced = solarTemplate().items.find((x) => x.title === 'Invoiced')!;
    expect(total(s, invoiced, itemRows(s, invoiced, null))).toBe(100);
    const it: DashItem = { id: 'x', type: 'chart', title: 'Avg', entity: 'invoices', measure: 'grandTotal', agg: 'avg', groupBy: 'customerId', split: 'status', w: 6, h: 3 };
    const data = itemSeries(s, it, s.all('invoices'));
    const byName = Object.fromEntries(data.series.map((x) => [x.name, x.values[0]]));
    expect(byName).toMatchObject({ Draft: 740, Sent: 100 });
  });
});

describe('warehouses never go below zero', () => {
  it('a move, a count everywhere, a hand entry and a challan without a warehouse take stock only from where it is', async () => {
    localStorage.clear();
    const b = new LocalBackend();
    const { user } = await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    const s = new Store(b); s.user = user; await s.load();
    const p = await s.create('products', { name: 'Panel', sku: 'P', category: 'Solar Panel' });
    const A = await s.create('warehouses', { name: 'A' });
    const B = await s.create('warehouses', { name: 'B' });
    await s.create('stockMoves', { productId: p.id, direction: 'In', qty: 10, date: '2026-05-01', reason: 'Opening stock' }); // not in a warehouse
    await s.create('stockMoves', { productId: p.id, direction: 'In', qty: 5, date: '2026-05-01', reason: 'Opening stock', warehouseId: A.id });
    await expect(s.transferStock(p.id, 15, A.id, B.id)).rejects.toThrow(/Only 5/);
    await expect(s.create('stockMoves', { productId: p.id, direction: 'Out', qty: 6, date: '2026-05-02', reason: 'Other', warehouseId: A.id })).rejects.toThrow(/Only 5 in A/);
    await expect(s.create('stockMoves', { productId: p.id, direction: 'Out', qty: 12, date: '2026-05-02', reason: 'Other' })).rejects.toThrow(/Choose the warehouse/);
    // Counted 3 in total (books: 15): 10 out of "not in a warehouse", then 2 out of A.
    expect(await s.adjustStock(p.id, 3)).toBe(-12);
    const places = Object.fromEntries(s.stockByWarehouse(p.id).map((x) => [x.warehouseId, x.qty]));
    expect(places).toEqual({ [A.id]: 3 });
    expect(s.stockByWarehouse(p.id).every((x) => x.qty >= 0)).toBe(true);
    // A challan naming no warehouse takes it from A.
    const c = await s.create('customers', { name: 'C', phone: '9000000009' });
    const pr = await s.create('projects', { name: 'P1', customerId: c.id });
    await s.create('dispatches', { projectId: pr.id, date: '2026-05-03', items: [{ productId: p.id, description: 'x', qty: 2, rate: 0, gstRate: 5 }], status: 'Dispatched' });
    expect(s.stockIn(p.id, A.id)).toBe(1);
    expect(s.stockIn(p.id, '')).toBe(0);
  });
});

describe('supplier payments', () => {
  it('are dated records: an order shows paid and still to pay (older undated amounts still count), no overpaying', async () => {
    localStorage.clear();
    const b = new LocalBackend();
    const { user } = await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    const s = new Store(b); s.user = user; await s.load();
    const v = await s.create('vendors', { name: 'V' });
    const other = await s.create('vendors', { name: 'W' });
    const po = await s.create('purchaseOrders', { vendorId: v.id, date: '2026-05-01', status: 'Ordered', items: [{ description: 'x', qty: 1, rate: 1000, gstRate: 0 }] });
    // As an older version left it: an undated amount typed on the order.
    const raw = s.get('purchaseOrders', po.id)!;
    await s.backend.update('purchaseOrders', { ...raw, paidAmount: 200 });
    await s.reload();
    expect(s.computed('purchaseOrders', s.get('purchaseOrders', po.id)!)).toMatchObject({ grandTotal: 1000, paid: 200, due: 800 });
    const pay = await s.create('supplierPayments', { purchaseOrderId: po.id, date: '2026-05-10', amount: 500, mode: 'UPI' });
    expect(pay.vendorId).toBe(v.id); // taken from the order
    expect(pay.number).toBe('SP/26-27/0001');
    expect(s.computed('purchaseOrders', s.get('purchaseOrders', po.id)!)).toMatchObject({ paid: 700, due: 300 });
    await expect(s.create('supplierPayments', { purchaseOrderId: po.id, date: '2026-05-11', amount: 301 })).rejects.toThrow(/More than is still to pay/);
    await expect(s.create('supplierPayments', { purchaseOrderId: po.id, vendorId: other.id, date: '2026-05-11', amount: 10 })).rejects.toThrow(/another vendor/);
    await expect(s.remove('purchaseOrders', po.id)).rejects.toThrow(/used by/);
  });
});
