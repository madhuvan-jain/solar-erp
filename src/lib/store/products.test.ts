// Product fixes from the products review, each with the case that used to go wrong.
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalBackend } from './local';
import { Store } from './store';
import { categoryPatch, taxFor } from '../productTax';
import { entityTable } from '../../modules/exportRows';
import { getEntity } from '../../modules/registry';

describe('products', () => {
  let s: Store;
  beforeEach(async () => {
    localStorage.clear();
    const b = new LocalBackend();
    const { user } = await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    s = new Store(b); s.user = user; await s.load();
  });

  it('GST and HSN follow the category: panels and inverters 5%, batteries, structures, cables and services 18%', async () => {
    expect([taxFor('Solar Panel'), taxFor('Inverter'), taxFor('Battery'), taxFor('Service'), taxFor(undefined)].map((t) => t.gst)).toEqual(['5', '5', '18', '18', '18']);
    // Changing the category moves untouched values along, never typed ones.
    expect(categoryPatch(undefined, 'Solar Panel', { gstRate: '18', hsn: '' })).toEqual({ gstRate: '5', hsn: '8541' });
    expect(categoryPatch('Solar Panel', 'Battery', { gstRate: '5', hsn: '8541' })).toEqual({ gstRate: '18', hsn: '8507' });
    expect(categoryPatch('Solar Panel', 'Battery', { gstRate: '12', hsn: '85414300' })).toEqual({});
    // Saved without a rate or HSN (an import): filled from the category.
    const bat = await s.create('products', { name: 'Lithium 5 kWh', sku: 'B5', category: 'Battery' });
    expect(bat).toMatchObject({ gstRate: '18', hsn: '8507' });
    const pan = await s.create('products', { name: 'Panel 545', sku: 'P545', category: 'Solar Panel' });
    expect(pan).toMatchObject({ gstRate: '5', hsn: '8541' });
  });

  it('an SKU belongs to one product; the stock unit is fixed once stock was booked', async () => {
    const p = await s.create('products', { name: 'Panel', sku: 'SV-545', category: 'Solar Panel' });
    await expect(s.create('products', { name: 'Panel copy', sku: ' sv-545 ', category: 'Solar Panel' }, { allowDuplicate: true })).rejects.toThrow(/already used by Panel/);
    await s.update('products', p.id, { unit: 'Set' }); // no stock yet: fine
    await s.create('stockMoves', { productId: p.id, direction: 'In', qty: 10, date: '2026-05-01', reason: 'Opening stock' });
    await expect(s.update('products', p.id, { unit: 'Watt' })).rejects.toThrow(/unit can no longer be changed/);
  });

  it('a challan never brings back stock that never left (product made stock-keeping later); returns not before the challan', async () => {
    const cable = await s.create('products', { name: 'Cable', sku: 'C1', category: 'Cable', unit: 'Meter', noStock: true });
    const c = await s.create('customers', { name: 'C', phone: '9000000401' });
    const pr = await s.create('projects', { name: 'P', customerId: c.id });
    const dc = await s.create('dispatches', { projectId: pr.id, date: '2026-05-10', status: 'Dispatched', items: [{ productId: cable.id, description: 'Cable', qty: 100, rate: 0, gstRate: 18 }] });
    await s.update('products', cable.id, { noStock: false });
    await s.update('dispatches', dc.id, { status: 'Cancelled' });
    expect(s.stockOf(cable.id)).toBe(0);
    // A real challan: the return may not be dated before it.
    const panel = await s.create('products', { name: 'Panel', sku: 'P1', category: 'Solar Panel' });
    await s.create('stockMoves', { productId: panel.id, direction: 'In', qty: 10, date: '2026-05-01', reason: 'Opening stock' });
    const dc2 = await s.create('dispatches', { projectId: pr.id, date: '2026-05-10', status: 'Dispatched', items: [{ productId: panel.id, description: 'Panel', qty: 4, rate: 0, gstRate: 5 }] });
    await expect(s.returnFromSite(dc2.id, { [panel.id]: 1 }, '2026-05-01')).rejects.toThrow(/before it left/);
    await s.returnFromSite(dc2.id, { [panel.id]: 1 }, '2026-05-12');
    expect(s.stockOf(panel.id)).toBe(7);
  });

  it('per-unit prices are not added up in exports', async () => {
    await s.create('products', { name: 'A', sku: 'A', category: 'Solar Panel', price: 100 });
    await s.create('products', { name: 'B', sku: 'B', category: 'Solar Panel', price: 200 });
    expect(entityTable(s, getEntity('products')!, s.all('products')).totals).toBeUndefined();
  });
});
