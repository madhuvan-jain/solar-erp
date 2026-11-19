import { beforeEach, describe, expect, it } from 'vitest';
import { LocalBackend } from './store/local';
import { Store } from './store/store';
import { WA_TEMPLATES, fillTemplate, waDisplay, waLink, waMessage, waNumber } from './whatsapp';

const line = (rate: number, qty = 1, gstRate = 0) => ({ description: 'Item', qty, rate, gstRate });

describe('WhatsApp numbers', () => {
  it('accepts Indian mobiles however written, other countries with their code; never landlines', () => {
    for (const v of ['98765 43210', '+91 98765 43210', '0091-98765-43210', '919876543210', '09876543210']) expect(waNumber(v)).toBe('919876543210');
    expect(waNumber('+971 50 123 4567')).toBe('971501234567');
    expect(waNumber('0086 138 0013 8000')).toBe('8613800138000');
    // (Landlines with codes from 1 to 5 — Delhi 011, Mumbai 022, Lucknow 0522 — can be told apart; 06xx ones look like mobiles.)
    for (const v of ['011 2345 6789', '022-23456789', '0522 2345678', '123', '', '+91 12345 67890', '0000000000']) expect(waNumber(v)).toBeNull();
    expect(waDisplay('919876543210')).toBe('+91 98765 43210');
    expect(waLink('98765 43210', 'नमस्ते & hi')).toBe('https://wa.me/919876543210?text=' + encodeURIComponent('नमस्ते & hi'));
  });
  it('fills templates and tidies what an empty fill-in leaves', () => {
    expect(fillTemplate('Dear {name}, due {balance} by {dueDate}. {upi}— {company}', { name: 'Ravi', balance: '₹10', dueDate: '', upi: '', company: '' }))
      .toBe('Dear Ravi, due ₹10 by.');
    expect(fillTemplate('बिल {number} ({date})।', { number: 'INV/26-27/0001', date: '' })).toBe('बिल INV/26-27/0001।');
    expect(WA_TEMPLATES.every((t) => t.en && t.hi && /\{name\}/.test(t.en) && /\{name\}/.test(t.hi))).toBe(true);
  });
});

describe('WhatsApp messages for records', () => {
  let s: Store;
  beforeEach(async () => {
    localStorage.clear();
    const b = new LocalBackend();
    const { user } = await b.setupAdmin('Asha', 'admin@example.com', 'password123', '9876543210');
    s = new Store(b); s.user = user; await s.load();
    await s.saveSettings({ companyName: 'Sun Power', state: 'Bihar', upiId: 'sunpower@upi' });
  });

  it('picks whom to message and the message that fits the record now', async () => {
    const lead = await s.create('leads', { name: 'Kiran', phone: '9000000501', whatsapp: '9000000599' });
    expect(waMessage(s, 'leads', lead)).toMatchObject({ number: '919000000599', template: 'lead' }); // the separate WhatsApp number wins
    const c = await s.create('customers', { name: 'Ravi', phone: '9000000502', state: 'Bihar' });
    expect(waMessage(s, 'customers', c)?.template).toBe('greeting');
    const q = await s.create('quotations', { customerId: c.id, date: '2026-11-01', systemKw: 3, items: [line(150000)] });
    expect(waMessage(s, 'quotations', q)?.text).toBe(`Dear Ravi, please find our quotation ${q.number} for a 3 kW solar system: ₹1,50,000.00. — Sun Power`);
    const inv = await s.create('invoices', { customerId: c.id, date: '2026-10-01', dueDate: '2026-10-16', status: 'Sent', items: [line(1000)] });
    const r = waMessage(s, 'invoices', inv, '2026-11-14')!;
    expect(r.template).toBe('reminder'); // overdue
    expect(r.text).toContain('UPI: sunpower@upi.');
    expect(waMessage(s, 'customers', c)?.template).toBe('statement'); // owes money now
    const pay = await s.create('payments', { invoiceId: inv.id, date: '2026-11-14', amount: 1000, mode: 'UPI' });
    expect(waMessage(s, 'invoices', s.get('invoices', inv.id)!)?.template).toBe('invoicePaid');
    expect(waMessage(s, 'payments', pay)?.text).toContain(`we have received ₹1,000.00 (receipt ${pay.number})`);
    // Vendors on purchase orders; the lead behind a survey; the customer behind an installation's project.
    const v = await s.create('vendors', { name: 'Volt Supplies', phone: '+971 50 123 4567' });
    const po = await s.create('purchaseOrders', { vendorId: v.id, date: '2026-11-10', items: [line(500)] });
    expect(waMessage(s, 'purchaseOrders', po)).toMatchObject({ number: '971501234567', template: 'purchaseOrder' });
    const sv = await s.create('surveys', { leadId: lead.id, surveyDate: '2026-11-20' });
    expect(waMessage(s, 'surveys', sv)?.text).toContain('20 Nov 2026');
    const pr = await s.create('projects', { name: 'Roof', customerId: c.id });
    const ins = await s.create('installations', { projectId: pr.id, scheduledDate: '2026-11-25' });
    expect(waMessage(s, 'installations', ins)?.name).toBe('Ravi');
    // A landline only: no WhatsApp.
    const land = await s.create('customers', { name: 'Office', phone: '011 2345 6789' });
    expect(waMessage(s, 'customers', land)).toBeNull();
  });

  it('uses the business\'s own wording (e.g. Hindi), and checks numbers', async () => {
    await s.saveSettings({ waTemplates: Object.fromEntries(WA_TEMPLATES.map((t) => [t.key, t.hi])) });
    const c = await s.create('customers', { name: 'Ravi', phone: '9000000503' });
    const q = await s.create('quotations', { customerId: c.id, date: '2026-11-01', systemKw: 5, items: [line(250000)] });
    expect(waMessage(s, 'quotations', q)?.text).toBe(`नमस्ते Ravi जी, 5 kW सोलर सिस्टम के लिए हमारा कोटेशन ${q.number}: ₹2,50,000.00। — Sun Power`);
    await expect(s.saveSettings({ whatsapp: '011 2345 6789' })).rejects.toThrow(/mobile number/);
    await s.saveSettings({ whatsapp: '98765 43210' });
    expect(s.settings().whatsapp).toBe('+919876543210');
    await expect(s.create('customers', { name: 'X', phone: '9000000504', whatsapp: '011 2345 6789' })).rejects.toThrow(/landline/);
    // A lead's WhatsApp number goes along when it becomes a customer.
    const lead = await s.create('leads', { name: 'Neha', phone: '9000000505', whatsapp: '9000000506' });
    const cust = await s.convertLead(lead.id);
    expect(cust.whatsapp).toBe('9000000506');
  });
});
