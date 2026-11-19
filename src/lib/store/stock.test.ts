// Stock done properly: part deliveries, warehouses, returns from site, transfers, counts, services,
// linked entries that cannot be edited on their own, and stock valued at what it really cost.
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalBackend } from './local';
import { Store } from './store';
import { computeAlerts } from '../alerts';
import { valuation } from './stock';
import type { Rec } from '../schema';

const line = (productId: string, qty: number, rate: number, extra: Record<string, unknown> = {}) => ({ productId, description: 'x', qty, rate, gstRate: 5, ...extra });

describe('stock', () => {
  let s: Store;
  let panel: Rec, inverter: Rec, service: Rec, vendor: Rec, whA: Rec, whB: Rec, project: Rec;
  beforeEach(async () => {
    localStorage.clear();
    const b = new LocalBackend();
    const { user } = await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    s = new Store(b);
    s.user = user;
    await s.load();
    panel = await s.create('products', { name: 'Panel 545', sku: 'P545', category: 'Solar Panel', cost: 12000, reorderLevel: 30 });
    inverter = await s.create('products', { name: 'Inverter 5kW', sku: 'INV5', category: 'Inverter', cost: 38000 });
    service = await s.create('products', { name: 'Installation', sku: 'SVC', category: 'Service', unit: 'kW' });
    vendor = await s.create('vendors', { name: 'Waaree Distributor' });
    whA = await s.create('warehouses', { name: 'Patna store' });
    whB = await s.create('warehouses', { name: 'Gaya store' });
    const c = await s.create('customers', { name: 'Ravi', phone: '9000000001' });
    project = await s.create('projects', { name: 'Ravi 5 kW', customerId: c.id });
  });

  const order = (items: unknown[], extra: Record<string, unknown> = {}) =>
    s.create('purchaseOrders', { vendorId: vendor.id, date: '2026-05-01', status: 'Ordered', items, ...extra });

  it('receives part deliveries at the order cost, into a warehouse, and works out the status', async () => {
    const po = await order([line(panel.id, 100, 12500, { discountPct: 4 }), line(service.id, 5, 1000)], { warehouseId: whA.id });
    expect(s.onOrder(panel.id)).toBe(100);
    await s.receiveGoods(po.id, { [panel.id]: 80 }, { date: '2026-05-05' });
    expect(s.stockOf(panel.id)).toBe(80);
    expect(s.stockIn(panel.id, whA.id)).toBe(80);
    expect(s.onOrder(panel.id)).toBe(20);
    let now = s.get('purchaseOrders', po.id)!;
    expect(now.status).toBe('Partially Received');
    const move = s.movesFrom(po.id)[0];
    expect(move).toMatchObject({ reason: 'Purchase receipt', rate: 12000, warehouseId: whA.id, date: '2026-05-05', sourceType: 'purchaseOrders' });
    // Never more than is due; the order can no longer be changed or cancelled.
    await expect(s.receiveGoods(po.id, { [panel.id]: 21 })).rejects.toThrow(/only 20 still due/);
    await expect(s.update('purchaseOrders', po.id, { items: [line(panel.id, 90, 12500)] })).rejects.toThrow(/already received/);
    await expect(s.update('purchaseOrders', po.id, { status: 'Cancelled' })).rejects.toThrow(/cannot be cancelled/);
    // Marking it Received brings in exactly what was still due.
    await s.update('purchaseOrders', po.id, { status: 'Received' });
    now = s.get('purchaseOrders', po.id)!;
    expect(s.stockOf(panel.id)).toBe(100);
    expect(now).toMatchObject({ status: 'Received', stockReceived: true });
    expect(s.stockOf(service.id)).toBe(0); // services never become stock
    await expect(s.receiveGoods(po.id)).resolves.toBe(0);
    expect(s.stockOf(panel.id)).toBe(100);
  });

  it('uses the default warehouse, and refuses receiving for someone without inventory rights', async () => {
    await s.saveSettings({ defaultWarehouse: whB.id });
    const po = await order([line(inverter.id, 2, 38000)]);
    await s.receiveGoods(po.id);
    expect(s.stockIn(inverter.id, whB.id)).toBe(2);
    const po2 = await order([line(inverter.id, 1, 38000)]);
    s.user = { ...s.user!, role: 'accounts', access: { inventory: 'read' } };
    await expect(s.update('purchaseOrders', po2.id, { status: 'Received' })).rejects.toThrow(/Inventory/);
    await expect(s.receiveGoods(po2.id)).rejects.toThrow(/Inventory/);
    expect(s.get('purchaseOrders', po2.id)?.status).toBe('Ordered');
  });

  it('entries made by a document cannot be edited or deleted on their own — no phantom stock', async () => {
    const po = await order([line(panel.id, 10, 12000)], { warehouseId: whA.id });
    await s.receiveGoods(po.id);
    const dc = await s.create('dispatches', { projectId: project.id, date: '2026-05-06', warehouseId: whA.id, items: [line(panel.id, 10, 0)], status: 'Dispatched' });
    const out = s.movesFrom(dc.id)[0];
    await expect(s.remove('stockMoves', out.id)).rejects.toThrow(/cannot be deleted on its own/);
    await expect(s.update('stockMoves', out.id, { direction: 'In' })).rejects.toThrow(/Change it there/);
    await expect(s.remove('dispatches', dc.id)).rejects.toThrow(/Cancel it instead/);
    await expect(s.remove('purchaseOrders', po.id)).rejects.toThrow(/kept for the record/);
    // Cancelling puts back exactly what went out, even if the product was re-categorised meanwhile.
    await s.update('products', panel.id, { category: 'Service' });
    await s.update('dispatches', dc.id, { status: 'Cancelled' });
    expect(s.stockOf(panel.id)).toBe(10);
  });

  it('challans: stock per warehouse, no rolling back, partial returns from site, then cancel returns the rest', async () => {
    const po = await order([line(panel.id, 20, 12000)], { warehouseId: whA.id });
    await s.receiveGoods(po.id);
    await expect(s.create('dispatches', { projectId: project.id, date: '2026-05-06', warehouseId: whB.id, items: [line(panel.id, 5, 0)], status: 'Dispatched' }))
      .rejects.toThrow(/have 0 in Gaya store/);
    const dc = await s.create('dispatches', { projectId: project.id, date: '2026-05-06', warehouseId: whA.id, items: [line(panel.id, 12, 0), line(service.id, 5, 0)], status: 'Dispatched' });
    expect(s.stockOf(panel.id)).toBe(8);
    await expect(s.update('dispatches', dc.id, { status: 'Draft' })).rejects.toThrow(/already left the store/);
    await s.returnFromSite(dc.id, { [panel.id]: 3 }, '2026-05-20');
    expect(s.stockOf(panel.id)).toBe(11);
    await expect(s.returnFromSite(dc.id, { [panel.id]: 10 })).rejects.toThrow(/only 9 can come back/);
    expect(s.outstandingOn(s.get('dispatches', dc.id)!).get(panel.id)).toBe(9);
    await s.update('dispatches', dc.id, { status: 'Cancelled' });
    expect(s.stockOf(panel.id)).toBe(20);
    expect(s.outstandingOn(s.get('dispatches', dc.id)!).size).toBe(0);
  });

  it('services keep no stock; hand entries need an inventory manager and carry a reason', async () => {
    await expect(s.create('stockMoves', { productId: service.id, direction: 'In', qty: 5, date: '2026-05-01' })).rejects.toThrow(/service/);
    const m = await s.create('stockMoves', { productId: panel.id, direction: 'In', qty: 5, date: '2026-05-01', reason: 'Opening stock', rate: 11000 });
    expect(m.reason).toBe('Opening stock');
    s.user = { ...s.user!, role: 'accounts' }; // inventory: all documents, but not a manager
    await expect(s.create('stockMoves', { productId: panel.id, direction: 'In', qty: 5, date: '2026-05-01' })).rejects.toThrow(/inventory manager/);
  });

  it('moves stock between warehouses as a linked pair, and books stock counts', async () => {
    const po = await order([line(panel.id, 10, 12000)], { warehouseId: whA.id });
    await s.receiveGoods(po.id);
    await expect(s.transferStock(panel.id, 11, whA.id, whB.id)).rejects.toThrow(/Only 10/);
    await s.transferStock(panel.id, 4, whA.id, whB.id);
    expect(s.stockByWarehouse(panel.id)).toEqual(expect.arrayContaining([{ warehouseId: whA.id, qty: 6 }, { warehouseId: whB.id, qty: 4 }]));
    expect(s.stockOf(panel.id)).toBe(10);
    const pair = s.all('stockMoves').filter((x) => x.reason === 'Transfer');
    expect(pair).toHaveLength(2);
    expect(new Set(pair.map((x) => x.sourceId)).size).toBe(1);
    // Counted 5 in Patna where the books say 6: one entry of −1 with its reason.
    expect(await s.adjustStock(panel.id, 5, { warehouseId: whA.id, reason: 'Damage / scrap', note: 'cracked' })).toBe(-1);
    expect(s.stockOf(panel.id)).toBe(9);
    expect(await s.adjustStock(panel.id, 9)).toBe(0);
  });

  it('values stock at the moving average of what it cost, and project material at the cost it went out at', async () => {
    const po1 = await order([line(panel.id, 10, 10000)], { warehouseId: whA.id });
    await s.receiveGoods(po1.id);
    const po2 = await order([line(panel.id, 10, 14000)], { warehouseId: whA.id });
    await s.receiveGoods(po2.id);
    expect(s.stockValuation(panel.id)).toEqual({ qty: 20, value: 240000, avg: 12000 });
    await s.create('dispatches', { projectId: project.id, date: '2099-01-01', warehouseId: whA.id, items: [line(panel.id, 5, 0)], status: 'Dispatched' });
    const out = s.all('stockMoves').find((m) => m.direction === 'Out')!;
    expect(out.rate).toBe(12000);
    expect(s.stockValuation(panel.id)).toEqual({ qty: 15, value: 180000, avg: 12000 });
    expect(valuation([], 500)).toEqual({ qty: 0, value: 0, avg: 500 });
  });

  it('low-stock alerts skip services and say what is on order', async () => {
    await s.update('products', service.id, { reorderLevel: 3 });
    const po = await order([line(panel.id, 50, 12000)]);
    await s.receiveGoods(po.id, { [panel.id]: 10 });
    const a = computeAlerts(s, '2026-05-10');
    expect(a.find((x) => x.recordId === panel.id)?.text).toBe('Low stock: Panel 545 (10 left, 40 on order)');
    expect(a.some((x) => x.recordId === service.id)).toBe(false);
  });

  it('orders received in full by an older version are never received twice', async () => {
    const po = await order([line(panel.id, 10, 12000)]);
    // As an older version left it: flag set, no breakdown, its stock entry without a link.
    await s.create('stockMoves', { productId: panel.id, direction: 'In', qty: 10, date: '2026-05-02', reference: `PO ${po.number}` });
    const raw = s.get('purchaseOrders', po.id)!;
    await s.backend.update('purchaseOrders', { ...raw, status: 'Received', stockReceived: true });
    await s.reload();
    expect(s.onOrder(panel.id)).toBe(0);
    await expect(s.receiveGoods(po.id)).resolves.toBe(0);
    expect(s.stockOf(panel.id)).toBe(10);
  });
});
