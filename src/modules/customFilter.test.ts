import { describe, expect, it } from 'vitest';
import { getEntity } from './registry';
import { customFields, decodeCustom, describeCustom, encodeCustom, testCustom, type CustomFilter } from './customFilter';
import { searchRows, EMPTY_SEARCH } from './search';
import { LocalBackend } from '../lib/store/local';
import { Store } from '../lib/store/store';
import type { Rec } from '../lib/schema';
import { groupOptions, groupValue } from '../ui/components/Views';

async function store() {
  const b = new LocalBackend();
  await b.setupAdmin('A', 'a@x.com', 'password123', '9876543210');
  const s = new Store(b);
  s.user = await b.currentUser();
  await s.load();
  return s;
}
const rec = (x: Record<string, unknown>): Rec => ({ id: String(Math.random()), createdAt: '2026-11-01T05:00:00Z', updatedAt: '2026-11-01T05:00:00Z', ...x });

describe('custom filters (field · condition · value)', () => {
  it('numbers, dates, text, pick lists, set / not set, and between', async () => {
    const s = await store();
    const e = getEntity('leads')!;
    const defs = customFields(s, e);
    const a = rec({ name: 'Asha Devi', capacityKw: 3, monthlyBill: 2500, source: 'Website', nextFollowUp: '2026-11-10T10:00' });
    const b = rec({ name: 'Mill Owner', capacityKw: 50, monthlyBill: 90000, source: 'Referral' });
    const t = (c: CustomFilter) => [a, b].filter((r) => testCustom(s, e, defs, c, r)).map((r) => r.name);
    expect(t({ field: 'capacityKw', op: 'gte', value: '5' })).toEqual(['Mill Owner']);
    expect(t({ field: 'capacityKw', op: 'between', value: '1', value2: '10' })).toEqual(['Asha Devi']);
    expect(t({ field: 'monthlyBill', op: 'lt', value: '3000' })).toEqual(['Asha Devi']);
    expect(t({ field: 'name', op: 'contains', value: 'mill' })).toEqual(['Mill Owner']);
    expect(t({ field: 'name', op: 'ncontains', value: 'mill' })).toEqual(['Asha Devi']);
    expect(t({ field: 'source', op: 'eq', value: 'Referral' })).toEqual(['Mill Owner']);
    expect(t({ field: 'source', op: 'neq', value: 'Referral' })).toEqual(['Asha Devi']);
    expect(t({ field: 'nextFollowUp', op: 'set' })).toEqual(['Asha Devi']);
    expect(t({ field: 'nextFollowUp', op: 'unset' })).toEqual(['Mill Owner']);
    expect(t({ field: 'nextFollowUp', op: 'between', value: '2026-11-30', value2: '2026-11-01' })).toEqual(['Asha Devi']); // either order
    expect(t({ field: 'createdAt', op: 'eq', value: '2026-11-01' })).toHaveLength(2);
    expect(t({ field: 'gone', op: 'eq', value: 'x' })).toHaveLength(2); // an unknown field hides nothing
  });

  it('computed money (invoice balance), readable facets, and the address round trip', async () => {
    const s = await store();
    const c = await s.create('customers', { name: 'Asha', phone: '9811111111' });
    const inv = await s.create('invoices', { customerId: c.id, date: '2026-11-01', status: 'Sent', items: [{ description: 'Panel', qty: 1, rate: 10000, gstRate: 5 }] });
    await s.create('payments', { invoiceId: inv.id, date: '2026-11-02', amount: 4000, mode: 'UPI' });
    const e = getEntity('invoices')!;
    const defs = customFields(s, e);
    expect(testCustom(s, e, defs, { field: 'balance', op: 'gte', value: '6500' }, inv)).toBe(true);
    expect(testCustom(s, e, defs, { field: 'balance', op: 'gte', value: '6501' }, inv)).toBe(false);
    expect(describeCustom(defs, { field: 'balance', op: 'gte', value: '5000' })).toEqual({ label: 'Balance due', value: '≥ ₹5,000.00' });
    expect(describeCustom(defs, { field: 'customerId', op: 'eq', value: c.id })).toEqual({ label: 'Customer', value: 'is Asha' });
    expect(describeCustom(defs, { field: 'date', op: 'between', value: '2026-04-01', value2: '2026-06-30' }).value).toMatch(/^between .*2026 and .*2026$/);
    const odd: CustomFilter = { field: 'notes', op: 'contains', value: 'a|b~c d/e%' };
    expect(decodeCustom(encodeCustom(odd))).toEqual(odd);
    expect(decodeCustom('x|drop table|1')).toBeNull();
    const rows = searchRows(s, e, s.all('invoices'), { ...EMPTY_SEARCH, c: [{ field: 'balance', op: 'gt', value: '0' }] }, { store: s, me: '', today: '2026-11-06', companyState: '' });
    expect(rows).toHaveLength(1);
  });

  it('group by quarter and financial year use April–March', async () => {
    const s = await store();
    const e = getEntity('invoices')!;
    const g = groupOptions(e);
    const q = g.find((x) => x.key === 'date:quarter')!, y = g.find((x) => x.key === 'date:year')!;
    expect(groupValue(s, e, q, rec({ date: '2026-04-01' }))).toBe('FY 2026-27 Q1');
    expect(groupValue(s, e, q, rec({ date: '2026-12-31' }))).toBe('FY 2026-27 Q3');
    expect(groupValue(s, e, q, rec({ date: '2027-03-31' }))).toBe('FY 2026-27 Q4');
    expect(groupValue(s, e, y, rec({ date: '2027-01-15' }))).toBe('FY 2026-27');
    expect(groupValue(s, e, y, rec({ date: '2027-04-01' }))).toBe('FY 2027-28');
  });
});
