import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENTITIES, getEntity } from './registry';
import { applyFilters, dayOf, filtersFor, period, type FilterCtx } from './filters';
import { LocalBackend } from '../lib/store/local';
import { Store } from '../lib/store/store';
import { prepareDemo, type DemoFile } from '../lib/demo';
import type { Rec } from '../lib/schema';

const rec = (x: Record<string, unknown>): Rec => ({ id: String(Math.random()), createdAt: '2026-11-01T05:00:00Z', updatedAt: '2026-11-01T05:00:00Z', ...x });

describe('list filters', () => {
  it("periods follow the calendar and India's April–March financial year", () => {
    expect(period('month', '2026-02-14')).toEqual(['2026-02-01', '2026-02-28']);
    expect(period('lastMonth', '2026-01-10')).toEqual(['2025-12-01', '2025-12-31']);
    expect(period('quarter', '2026-11-06')).toEqual(['2026-10-01', '2026-12-31']);
    expect(period('fy', '2026-11-06')).toEqual(['2026-04-01', '2027-03-31']);
    expect(period('fy', '2027-02-01')).toEqual(['2026-04-01', '2027-03-31']);
    expect(period('lastFy', '2026-04-01')).toEqual(['2025-04-01', '2026-03-31']);
    expect(dayOf('2026-11-05T10:30')).toBe('2026-11-05');
  });

  it('every record type has filters with unique keys, a "Mine" section, and its status values', () => {
    for (const e of ENTITIES) {
      const defs = filtersFor(e);
      const keys = defs.map((d) => d.key);
      expect(new Set(keys).size, e.key).toBe(keys.length);
      expect(defs.some((d) => d.key === 'me:created'), e.key).toBe(true);
      if (e.statusField) {
        const opts = e.fields.find((f) => f.key === e.statusField)!.options!;
        for (const o of opts) expect(keys, `${e.key} ${o}`).toContain(`st:${o}`);
      }
    }
  });

  it('OR inside a section, AND between sections', async () => {
    const b = new LocalBackend();
    await b.setupAdmin('A', 'a@x.com', 'password123', '9876543210');
    const s = new Store(b);
    s.user = await b.currentUser();
    const ctx: FilterCtx = { store: s, me: s.user!.id, today: '2026-11-06', companyState: 'Bihar' };
    const leads = [
      rec({ name: 'A', status: 'New', segment: 'Residential', capacityKw: 3, nextFollowUp: '2026-11-01T10:00' }),
      rec({ name: 'B', status: 'Contacted', segment: 'Commercial', capacityKw: 25, nextFollowUp: '2026-11-06T16:00' }),
      rec({ name: 'C', status: 'Won', segment: 'Residential', capacityKw: 5, nextFollowUp: '2026-10-01T10:00' }),
      rec({ name: 'D', status: 'New', segment: 'Agriculture', assignedTo: ctx.me }),
    ];
    const e = getEntity('leads')!;
    const names = (keys: string[]) => applyFilters(e, leads, keys, ctx).map((r) => r.name);
    expect(names(['st:New', 'st:Contacted'])).toEqual(['A', 'B', 'D']);
    expect(names(['st:New', 'seg:res'])).toEqual(['A']);
    expect(names(['fu:overdue'])).toEqual(['A']); // C is won, so not overdue
    expect(names(['fu:today'])).toEqual(['B']);
    expect(names(['capacityKw:upto3'])).toEqual(['A']);
    expect(names(['capacityKw:over10'])).toEqual(['B']);
    expect(names(['me:assignedTo'])).toEqual(['D']);
    expect(names(['unassigned', 'open'])).toEqual(['A', 'B']);
    expect(names(['no-such-filter'])).toEqual(['A', 'B', 'C', 'D']);
  });

  it("money and stock filters use the app's own totals: unpaid, partly paid, overdue invoices; low stock", async () => {
    const b = new LocalBackend();
    await b.setupAdmin('A', 'a@x.com', 'password123', '9876543210');
    const s = new Store(b);
    s.user = await b.currentUser();
    await s.load();
    await s.saveSettings({ state: 'Bihar' });
    const c = await s.create('customers', { name: 'Asha', phone: '9811111111', state: 'Bihar' });
    const far = await s.create('customers', { name: 'Ravi', phone: '9811111112', state: 'Rajasthan' });
    const line = [{ description: 'Panel', qty: 1, rate: 10000, gstRate: 5 }];
    const unpaid = await s.create('invoices', { customerId: c.id, date: '2026-10-01', dueDate: '2026-10-31', status: 'Sent', items: line });
    const part = await s.create('invoices', { customerId: c.id, date: '2026-11-01', dueDate: '2026-12-01', status: 'Sent', items: line });
    const igst = await s.create('invoices', { customerId: far.id, date: '2026-11-02', dueDate: '2026-12-02', status: 'Sent', items: line });
    await s.create('payments', { invoiceId: part.id, date: '2026-11-02', amount: 5000, mode: 'UPI' });
    await s.create('payments', { invoiceId: igst.id, date: '2026-11-03', amount: 10500, mode: 'UPI' });
    const ctx: FilterCtx = { store: s, me: s.user!.id, today: '2026-11-06', companyState: 'Bihar' };
    const e = getEntity('invoices')!;
    const ids = (keys: string[]) => applyFilters(e, s.all('invoices'), keys, ctx).map((r) => r.id);
    expect(ids(['pay:unpaid'])).toEqual([unpaid.id]);
    expect(ids(['pay:part'])).toEqual([part.id]);
    expect(ids(['pay:paid'])).toEqual([igst.id]);
    expect(ids(['due:over'])).toEqual([unpaid.id]);
    expect(ids(['igst'])).toEqual([igst.id]);
    expect(ids(['d:month']).sort()).toEqual([part.id, igst.id].sort());

    const p = await s.create('products', { name: 'Panel 545', sku: 'P1', category: 'Solar Panel', price: 10000, gstRate: '5', reorderLevel: 10 });
    await s.create('stockMoves', { productId: p.id, direction: 'In', qty: 4, date: '2026-11-01' });
    const pe = getEntity('products')!;
    expect(applyFilters(pe, s.all('products'), ['st:low'], ctx)).toHaveLength(1);
    expect(applyFilters(pe, s.all('products'), ['st:out'], ctx)).toHaveLength(0);
    expect(applyFilters(pe, s.all('products'), ['gst:5', 'category:Solar Panel'], ctx)).toHaveLength(1);
  });

  it('every filter runs on every demo record (785 real-looking records) without errors', async () => {
    const file = JSON.parse(readFileSync(join(__dirname, '..', '..', 'public', 'demo', 'demo-data.json'), 'utf8')) as DemoFile;
    const b = new LocalBackend();
    const { user } = await b.setupAdmin('A', 'a@x.com', 'password123', '9876543210');
    const s = new Store(b);
    s.user = user;
    await s.load();
    await s.replaceAll(prepareDemo(file, user.id, '2026-11-06'));
    const ctx: FilterCtx = { store: s, me: user.id, today: '2026-11-06', companyState: 'Bihar' };
    let hits = 0;
    for (const e of ENTITIES) {
      const rows = s.all(e.key);
      for (const f of filtersFor(e)) {
        const n = rows.filter((r) => f.test(r, ctx)).length;
        expect(n).toBeLessThanOrEqual(rows.length);
        hits += n;
        // An empty record never throws either.
        expect(() => f.test(rec({}), ctx)).not.toThrow();
      }
    }
    expect(hits).toBeGreaterThan(500);
  });
});
