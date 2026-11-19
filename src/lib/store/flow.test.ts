// Lead → quotation → confirmed order → project → invoice, the activity log, alert choices and the
// "customise the dashboard" helpers.
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalBackend } from './local';
import { ACTIVITY, Store } from './store';
import { ALERT_TYPES, alertPrefs, alertType, myAlerts, saveAlertPrefs } from '../alerts';
import { listOrder, rememberOrder } from '../recordOrder';
import { arrange, dropBefore, shift } from '../../ui/pages/Dashboard';

async function freshStore() {
  localStorage.clear();
  const b = new LocalBackend();
  const { user: admin } = await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
  const s = new Store(b);
  s.user = admin;
  await s.load();
  return { s, b };
}
const line = (rate: number, qty = 1, gstRate = 0) => ({ description: 'Panel 540Wp', qty, rate, gstRate });

describe('lead → quotation → order → project → invoice', () => {
  let s: Store;
  beforeEach(async () => { ({ s } = await freshStore()); });

  it('a converted lead brings its state and PIN code to the customer', async () => {
    const lead = await s.create('leads', { name: 'Ravi', phone: '9876543210', city: 'Patna', state: 'Bihar', pincode: '800001' });
    const c = await s.convertLead(lead.id);
    expect(c).toMatchObject({ name: 'Ravi', state: 'Bihar', pincode: '800001', lifecycle: 'Prospect' });
    expect(s.get('leads', lead.id)?.customerId).toBe(c.id);
    expect((await s.convertLead(lead.id)).id).toBe(c.id); // converting again gives the same customer
  });

  it('confirming wins the lead, activates the customer, starts one project and carries it to the invoice', async () => {
    const lead = await s.create('leads', { name: 'Asha', phone: '9123456780' });
    const c = await s.convertLead(lead.id);
    const q = await s.create('quotations', { customerId: c.id, leadId: lead.id, systemKw: 3, date: '2026-05-01', items: [line(50000, 3, 12)] });
    expect(q.validTill).toBeTruthy(); // validity comes from Settings → Sales (15 days by default)

    const { quote, project } = await s.confirmQuotation(q.id);
    expect(quote.status).toBe('Accepted');
    expect(project).toMatchObject({ name: 'Asha — 3 kW', customerId: c.id, stage: 'Planning', budget: s.computed('quotations', q).grandTotal });
    expect(s.get('leads', lead.id)?.status).toBe('Won');
    expect(s.get('customers', c.id)?.lifecycle).toBe('Active Project');
    expect(quote.projectId).toBe(project!.id);

    const again = await s.confirmQuotation(q.id); // no second project
    expect(again.project?.id).toBe(project!.id);
    expect(s.all('projects')).toHaveLength(1);

    const inv = await s.quotationToInvoice(q.id);
    expect(inv.projectId).toBe(project!.id);
  });

  it('an invoiced quotation is locked; rejected or expired ones cannot be confirmed or invoiced', async () => {
    const c = await s.create('customers', { name: 'C', phone: '9876543211' });
    const other = await s.create('customers', { name: 'D', phone: '9876543212' });
    const q = await s.create('quotations', { customerId: c.id, date: '2026-05-01', items: [line(100)] });
    await s.quotationToInvoice(q.id);
    await expect(s.update('quotations', q.id, { items: [line(90)] })).rejects.toThrow();
    await expect(s.update('quotations', q.id, { discount: 5 })).rejects.toThrow();
    await expect(s.update('quotations', q.id, { customerId: other.id })).rejects.toThrow();
    await s.update('quotations', q.id, { notes: 'called the customer' }); // other fields still change

    const r = await s.create('quotations', { customerId: c.id, date: '2026-05-01', items: [line(100)], status: 'Rejected' });
    await expect(s.confirmQuotation(r.id)).rejects.toThrow(/rejected/);
    await expect(s.quotationToInvoice(r.id)).rejects.toThrow(/rejected/);
  });
});

describe('activity log', () => {
  let s: Store;
  beforeEach(async () => { ({ s } = await freshStore()); });

  it('records creation, each change (old → new) and notes, newest first', async () => {
    const l = await s.create('leads', { name: 'Ravi', phone: '9876543210', status: 'New' });
    await s.update('leads', l.id, { status: 'Contacted', city: 'Gaya' });
    await s.addNote('leads', l.id, '  Called, wants 3 kW  ');
    const log = s.activityFor('leads', l.id);
    expect(log.map((a) => a.kind)).toEqual(['note', 'changed', 'created']);
    expect(log[0].text).toBe('Called, wants 3 kW');
    expect(log[0].createdBy).toBe(s.user!.id);
    expect(log[1].changes).toEqual(expect.arrayContaining([
      { field: 'status', label: expect.any(String), from: 'New', to: 'Contacted' },
      { field: 'city', label: expect.any(String), from: '—', to: 'Gaya' },
    ]));
    // An update that changes nothing visible adds nothing.
    await s.update('leads', l.id, {});
    expect(s.activityFor('leads', l.id)).toHaveLength(3);
    // The history is saved with the data (and so in backups).
    expect(s.exportAll()[ACTIVITY]?.length).toBe(3);
  });

  it('refuses empty or very long notes and notes on missing records', async () => {
    const l = await s.create('leads', { name: 'Ravi', phone: '9876543210' });
    await expect(s.addNote('leads', l.id, '   ')).rejects.toThrow(/Write a note/);
    await expect(s.addNote('leads', l.id, 'x'.repeat(4001))).rejects.toThrow(/4,000/);
    await expect(s.addNote('leads', 'nope', 'hi')).rejects.toThrow(/no longer exists/);
  });
});

describe('alert choices', () => {
  it('custom alerts are off by default; turned on, only the ticked kinds show', async () => {
    const { s } = await freshStore();
    await s.create('leads', { name: 'Late', phone: '9000000001', nextFollowUp: '2020-01-01T10:00' });
    const p = await s.create('products', { name: 'Panel', sku: 'P1', reorderLevel: 5 });
    expect(p).toBeTruthy();
    const all = () => myAlerts(s, () => true, () => 'crm', '2026-05-01');
    expect(alertPrefs(s.user!.id)).toEqual({ custom: false, on: ALERT_TYPES.map((t) => t.key) });
    const kinds = new Set(all().map(alertType));
    expect(kinds.has('fu')).toBe(true);

    saveAlertPrefs(s.user!.id, { custom: true, on: ['st'] });
    expect(all().every((a) => alertType(a) === 'st')).toBe(true);
    expect(all().some((a) => alertType(a) === 'fu')).toBe(false);

    saveAlertPrefs(s.user!.id, { custom: false, on: [] }); // switched off again → everything is back
    expect(all().some((a) => alertType(a) === 'fu')).toBe(true);
  });
});

describe('changing my mobile number (device mode)', () => {
  it('needs the current password once a number is set', async () => {
    const { b } = await freshStore();
    await expect(b.setMyPhone('9000011111')).rejects.toThrow(/current password/);
    await expect(b.setMyPhone('9000011111', { password: 'wrong-one' })).rejects.toThrow(/wrong/);
    await b.setMyPhone('9000011111', { password: 'password123' });
    expect((await b.currentUser())?.phone).toBe('+919000011111');
  });
});

describe('record pager order and dashboard arranging', () => {
  it('remembers the list order for ‹ › on a record', () => {
    expect(listOrder('leads')).toBeNull();
    rememberOrder('leads', ['b', 'a', 'c']);
    expect(listOrder('leads')).toEqual(['b', 'a', 'c']);
  });

  it('arrange keeps the saved order, drops unknown items and adds new ones at the end', () => {
    expect(arrange(['c', 'x', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    expect(shift(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(shift(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(dropBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(dropBefore(['a', 'b', 'c'], 'a', 'a')).toEqual(['a', 'b', 'c']);
  });
});

describe('preferences follow the person (cloud mode)', () => {
  it('pulls saved choices from the account once, then sends each change', async () => {
    const { s } = await freshStore();
    const uid = s.user!.id;
    const account: Record<string, unknown> = { defdash: { kpis: ['b', 'a'], blocks: [], hidden: [] }, alertprefs: { custom: true, on: ['iv'] } };
    const sent: string[] = [];
    s.backend.loadPrefs = async () => ({ ...account });
    s.backend.savePref = async (k, v) => { account[k] = v; sent.push(k); };
    const { connectPrefs } = await import('../prefs');
    let heard = 0;
    const h = () => heard++;
    window.addEventListener('ss1-alertprefs', h);
    const stop = connectPrefs(s);
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(localStorage.getItem(`ss1:defdash:${uid}`)!)).toEqual(account.defdash);
    expect(alertPrefs(uid)).toEqual({ custom: true, on: ['iv'] });
    expect(heard).toBe(1);
    saveAlertPrefs(uid, { custom: true, on: ['iv', 'st'] });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['alertprefs']);
    expect(account.alertprefs).toEqual({ custom: true, on: ['iv', 'st'] });
    stop();
    saveAlertPrefs(uid, { custom: false, on: [] }); // signed out: nothing is sent
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    window.removeEventListener('ss1-alertprefs', h);
  });

  it('a change made while offline is sent on the next sign-in instead of being overwritten', async () => {
    const { s } = await freshStore();
    const uid = s.user!.id;
    const account: Record<string, unknown> = { alertprefs: { custom: true, on: ['iv'] } };
    let online = false;
    s.backend.loadPrefs = async () => ({ ...account });
    s.backend.savePref = async (k, v) => { if (!online) throw new Error('offline'); account[k] = v; };
    const { connectPrefs } = await import('../prefs');
    let stop = connectPrefs(s);
    await new Promise((r) => setTimeout(r, 0));
    saveAlertPrefs(uid, { custom: true, on: ['st'] }); // offline: not sent
    await new Promise((r) => setTimeout(r, 0));
    stop();
    online = true;
    stop = connectPrefs(s); // next sign-in
    await new Promise((r) => setTimeout(r, 10));
    expect(alertPrefs(uid)).toEqual({ custom: true, on: ['st'] }); // kept, not replaced by the server's older copy
    expect(account.alertprefs).toEqual({ custom: true, on: ['st'] }); // and now sent
    stop();
  });
});
