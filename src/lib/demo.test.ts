import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { daysBetween, prepareDemo, shiftDate, type DemoFile } from './demo';
import { LocalBackend } from './store/local';
import { Store } from './store/store';
import { computeAlerts } from './alerts';
import { backupProblem } from '../ui/pages/Settings';

const FILE = JSON.parse(readFileSync(join(__dirname, '..', '..', 'public', 'demo', 'demo-data.json'), 'utf8')) as DemoFile;

describe('demo data', () => {
  beforeEach(() => { localStorage.clear(); });

  it('moves dates by whole days and keeps their format', () => {
    expect(daysBetween('2026-11-04', '2027-01-02')).toBe(59);
    expect(shiftDate('2026-11-04', 3)).toBe('2026-11-07');
    expect(shiftDate('2026-12-30T10:30', 3)).toBe('2027-01-02T10:30');
    expect(shiftDate('2026-02-27T05:30:00.000Z', 2)).toBe('2026-03-01T05:30:00.000Z');
    expect(shiftDate('INV/26-27/0001', 5)).toBe('INV/26-27/0001');
    expect(shiftDate('98350 12345', 5)).toBe('98350 12345');
  });

  it('prepares the file for today: same records, owner replaced, dates moved, files untouched', () => {
    const today = '2027-03-15';
    const data = prepareDemo(FILE, 'me-123', today);
    const days = daysBetween(FILE.generatedOn, today);
    expect(backupProblem(data)).toBeNull();
    for (const k of Object.keys(FILE.data)) expect(data[k]).toHaveLength(FILE.data[k].length);
    expect(JSON.stringify(data)).not.toContain(FILE.ownerId);
    const inv0 = FILE.data.invoices[0], inv = data.invoices[0];
    expect(inv.date).toBe(shiftDate(String(inv0.date), days));
    expect(inv.number).toBe(inv0.number);
    const doc = data.documents.find((d) => d.file)!;
    expect((doc.file as { dataUrl: string }).dataUrl).toBe((FILE.data.documents.find((d) => d.id === doc.id)!.file as { dataUrl: string }).dataUrl);
    expect(() => prepareDemo({ ...FILE, kind: 'backup' } as unknown as DemoFile, 'x', today)).toThrow(/damaged/);
  });

  it('loads into the app and adds up: totals, balances, stock, alerts and numbering all work', async () => {
    const b = new LocalBackend();
    const { user: admin } = await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    const s = new Store(b);
    s.user = admin;
    await s.load();
    await s.replaceAll(prepareDemo(FILE, admin.id, new Date().toISOString().slice(0, 10)));

    expect(s.all('customers').length).toBeGreaterThan(40);
    expect(s.settings().companyName).toMatch(/Demo/);
    // Totals the generator stored agree with the app's own GST maths.
    for (const inv of s.all('invoices')) {
      if (typeof inv.grandTotal === 'number') expect(s.totalsFor('invoices', inv).grandTotal, String(inv.number)).toBe(inv.grandTotal);
    }
    // No invoice is paid more than its total; payments point at real invoices.
    for (const inv of s.all('invoices')) expect(s.computed('invoices', inv).balance ?? 0).toBeGreaterThanOrEqual(0);
    for (const p of s.all('payments')) expect(s.get('invoices', p.invoiceId), String(p.number)).toBeTruthy();
    // Stock never goes below zero.
    for (const p of s.all('products')) if (p.category !== 'Service') expect(s.stockOf(p.id), String(p.name)).toBeGreaterThanOrEqual(0);
    expect(computeAlerts(s).length).toBeGreaterThan(0);

    // A new invoice continues the series instead of clashing with a demo number.
    const c = s.all('customers')[0];
    const before = s.all('invoices').map((i) => String(i.number));
    const inv = await s.create('invoices', { customerId: c.id, date: new Date().toISOString().slice(0, 10), items: [{ description: 'Test', qty: 1, rate: 100, gstRate: 5 }] });
    expect(before).not.toContain(inv.number);
  });
});
