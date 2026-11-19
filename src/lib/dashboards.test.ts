import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalBackend } from './store/local';
import { Store } from './store/store';
import { prepareDemo, type DemoFile } from './demo';
import { clampItem, deleteDashboard, itemRows, itemSeries, loadDashboard, saveDashboard, solarTemplate, total, type DashItem } from './dashboards';
import { periodRange } from '../ui/pages/Dashboard';

async function demoStore() {
  const file = JSON.parse(readFileSync(join(__dirname, '..', '..', 'public', 'demo', 'demo-data.json'), 'utf8')) as DemoFile;
  const b = new LocalBackend();
  const { user } = await b.setupAdmin('A', 'a@x.com', 'password123', '9876543210');
  const s = new Store(b);
  s.user = user;
  await s.load();
  await s.replaceAll(prepareDemo(file, user.id, new Date().toISOString().slice(0, 10)));
  return s;
}

describe('my dashboard', () => {
  it('saves one dashboard per person, sizes stay on the grid', () => {
    localStorage.clear();
    expect(loadDashboard('u1')).toBeNull();
    const d = solarTemplate();
    saveDashboard('u1', { ...d, items: [{ ...d.items[0], w: 40, h: 0 }] });
    const back = loadDashboard('u1')!;
    expect(back.items[0]).toMatchObject({ w: 12, h: 1 });
    expect(loadDashboard('u2')).toBeNull();
    deleteDashboard('u1');
    expect(loadDashboard('u1')).toBeNull();
    expect(clampItem({ ...d.items[0], w: 1, h: 9 })).toMatchObject({ w: 2, h: 6 });
  });

  it('numbers agree with the records: totals, counts, averages, filters and the period', async () => {
    const s = await demoStore();
    const range = periodRange('all');
    const inv: DashItem = { id: 'a', type: 'kpi', title: 'x', entity: 'invoices', measure: 'grandTotal', agg: 'sum', w: 3, h: 1 };
    const all = s.all('invoices');
    expect(total(s, inv, itemRows(s, inv, range))).toBeCloseTo(all.reduce((t, r) => t + s.computed('invoices', r).grandTotal, 0), 2);
    const due: DashItem = { ...inv, measure: 'balance', filters: ['pay:unpaid', 'pay:part'] };
    const dueRows = itemRows(s, due, range);
    expect(dueRows.every((r) => ['Unpaid', 'Partially Paid'].includes(s.paymentStatus(r)))).toBe(true);
    expect(total(s, { ...inv, agg: 'count', measure: '__count' }, all)).toBe(all.length);
    const avg = total(s, { ...inv, agg: 'avg' }, all);
    expect(avg).toBeCloseTo(total(s, inv, all) / all.length, 0);
    // The period only applies when the item follows it, on its own date field.
    const fy = periodRange('fy');
    const inFy = itemRows(s, { ...inv, dateField: 'date' }, fy);
    expect(inFy.every((r) => String(r.date) >= fy.from && String(r.date) <= fy.to)).toBe(true);
    expect(itemRows(s, inv, fy)).toHaveLength(all.length);
  });

  it('chart series: grouped, biggest first, "Other" past the limit, months in order', async () => {
    const s = await demoStore();
    const range = periodRange('all');
    const top: DashItem = { id: 'b', type: 'table', title: 'x', entity: 'invoices', measure: 'grandTotal', agg: 'sum', groupBy: 'customerId', limit: 5, w: 4, h: 3 };
    const d = itemSeries(s, top, itemRows(s, top, range));
    expect(d.labels).toHaveLength(5);
    expect(d.labels[4]).toBe('Other');
    const v = d.series[0].values;
    expect(v.slice(0, 4)).toEqual([...v.slice(0, 4)].sort((a, b) => b - a));
    expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(d.total, 0);
    const months: DashItem = { ...top, type: 'chart', groupBy: 'date', limit: undefined };
    const m = itemSeries(s, months, itemRows(s, months, range));
    expect(m.labels.length).toBeGreaterThan(1);
    expect(m.labels.join()).not.toContain('Other');
  });

  it('every item of the solar template computes on demo data without errors', async () => {
    const s = await demoStore();
    for (const it of solarTemplate().items) {
      if (!it.entity) continue;
      const rows = itemRows(s, it, periodRange('fy'));
      expect(Number.isFinite(total(s, it, rows))).toBe(true);
      if (it.type === 'chart' || it.type === 'table') expect(() => itemSeries(s, it, rows)).not.toThrow();
    }
  });
});

describe('trend comparison', () => {
  it('compares the same stretch of the previous period, not a whole one', () => {
    expect(periodRange('month', '2026-11-12')).toEqual({ from: '2026-11-01', to: '2026-11-12', prevFrom: '2026-10-01', prevTo: '2026-10-12' });
    expect(periodRange('month', '2026-03-31')).toMatchObject({ prevFrom: '2026-02-01', prevTo: '2026-02-28' }); // a shorter month ends there
    expect(periodRange('fy', '2026-11-12')).toEqual({ from: '2026-04-01', to: '2026-11-12', prevFrom: '2025-04-01', prevTo: '2025-11-12' });
  });
});
