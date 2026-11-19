import { describe, expect, it } from 'vitest';
import { amountInWords, computeEmi, computeTotals, financialYear, hsnSummary, round2 } from './money';
import { csvToObjects, parseCsv, toCsv, unguard } from './csv';
import { coerce, isValidDate, isValidGstin, isValidPhone, normalizePhone, validateField, validateRecord } from './validate';
import { addDaysIso, localDateOf, localDateTimeOf, uid } from './format';
import { waLink as whatsappLink } from './whatsapp';
import { canonicalState, stateFromGstin } from './states';
import { backupProblem } from '../ui/pages/Settings';
import { nextEmiDate } from './alerts';
import { getEntity } from '../modules/registry';

describe('money', () => {
  it('rounds without float drift', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('splits GST into CGST/SGST intra-state and IGST inter-state', () => {
    const items = [{ description: 'Panel', qty: 10, rate: 10000, gstRate: 12 }];
    const intra = computeTotals(items, 0, false);
    expect(intra.subtotal).toBe(100000);
    expect(intra.cgst).toBe(6000);
    expect(intra.sgst).toBe(6000);
    expect(intra.igst).toBe(0);
    expect(intra.grandTotal).toBe(112000);
    const inter = computeTotals(items, 0, true);
    expect(inter.igst).toBe(12000);
    expect(inter.cgst).toBe(0);
  });

  it('applies discount before tax, pro-rata across mixed GST rates', () => {
    const t = computeTotals([
      { description: 'A', qty: 1, rate: 1000, gstRate: 12 },
      { description: 'B', qty: 1, rate: 1000, gstRate: 18 },
    ], 200);
    expect(t.taxable).toBe(1800);
    expect(t.tax).toBe(round2(900 * 0.12 + 900 * 0.18));
  });

  it('caps discount at subtotal and ignores negative discounts', () => {
    const items = [{ description: 'A', qty: 1, rate: 100, gstRate: 18 }];
    expect(computeTotals(items, 500).grandTotal).toBe(0);
    expect(computeTotals(items, -50).grandTotal).toBe(118);
  });

  it('handles empty / missing items', () => {
    expect(computeTotals(undefined).grandTotal).toBe(0);
    expect(computeTotals([]).grandTotal).toBe(0);
  });

  it('CGST always equals SGST and the total is rounded to the rupee', () => {
    const t = computeTotals([{ description: 'A', qty: 1, rate: 1000.4167, gstRate: 18 }]);
    expect(t.cgst).toBe(t.sgst);
    expect(Number.isInteger(t.grandTotal)).toBe(true);
    expect(round2(t.taxable + t.tax + t.roundOff)).toBe(t.grandTotal);
  });

  it('builds an HSN summary that matches the invoice tax', () => {
    const items = [
      { description: 'Panel', hsn: '8541', qty: 2, rate: 1000, gstRate: 12 },
      { description: 'Panel 2', hsn: '8541', qty: 1, rate: 500, gstRate: 12 },
      { description: 'Service', hsn: '9954', qty: 1, rate: 500, gstRate: 18 },
    ];
    const rows = hsnSummary(items, 300);
    expect(rows.map((r) => r.hsn)).toEqual(['8541', '9954']);
    expect(round2(rows.reduce((s, r) => s + r.tax, 0))).toBeCloseTo(computeTotals(items, 300).tax, 1);
  });

  it('works out the Indian financial year', () => {
    expect(financialYear('2026-03-31')).toBe('25-26');
    expect(financialYear('2026-04-01')).toBe('26-27');
    expect(financialYear('2099-12-31')).toBe('99-00');
    expect(financialYear('')).toBe('');
  });

  it('odd-paise tax still sums exactly', () => {
    const t = computeTotals([{ description: 'A', qty: 1, rate: 0.33, gstRate: 5 }]);
    expect(round2(t.cgst + t.sgst)).toBe(t.tax);
  });

  it('computes EMI', () => {
    expect(computeEmi(100000, 12, 12)).toBeCloseTo(8884.88, 1);
    expect(computeEmi(12000, 0, 12)).toBe(1000);
    expect(computeEmi(0, 10, 12)).toBe(0);
    expect(computeEmi(1000, 10, 0)).toBe(0);
    expect(computeEmi(NaN, 10, 12)).toBe(0);
  });

  it('writes amounts in Indian words', () => {
    expect(amountInWords(0)).toBe('Zero Rupees Only');
    expect(amountInWords(112000)).toBe('One Lakh Twelve Thousand Rupees Only');
    expect(amountInWords(12345678.5)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees and Fifty Paise Only');
    expect(amountInWords(-1)).toBe('');
  });
});

describe('csv', () => {
  it('parses quotes, commas, newlines, CRLF and BOM', () => {
    const rows = parseCsv('﻿name,notes\r\n"Ravi, K","said ""hi""\nthen left"\r\n\r\nAsha,ok');
    expect(rows).toEqual([['name', 'notes'], ['Ravi, K', 'said "hi"\nthen left'], ['Asha', 'ok']]);
  });

  it('round-trips through toCsv', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'he said "no"'], [null, 5]]);
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['x,y', 'he said "no"'], ['', '5']]);
  });

  it('neutralises formula injection but keeps negative numbers', () => {
    expect(toCsv(['a'], [['=HYPERLINK("x")']])).toContain("'=HYPERLINK");
    expect(toCsv(['a'], [['-25']])).toBe('a\r\n-25');
  });

  it('does not swallow rows when a quote appears inside an unquoted cell', () => {
    expect(parseCsv('a,b\nPanel 12" x,1\nB,2\nC,3')).toEqual([['a', 'b'], ['Panel 12" x', '1'], ['B', '2'], ['C', '3']]);
  });

  it('guards every formula-like value but leaves plain numbers', () => {
    expect(toCsv(['a'], [['-1+1|cmd']])).toBe("a\r\n'-1+1|cmd");
    expect(toCsv(['a'], [['+91 98765']])).toBe("a\r\n'+91 98765");
    expect(toCsv(['a'], [['-12.5']])).toBe('a\r\n-12.5');
    expect(unguard("'+91 98765")).toBe('+91 98765');
    expect(csvToObjects("Phone\n'+91 98765 43210")[0].Phone).toBe('+91 98765 43210');
  });

  it('reads files that start with a byte-order mark', async () => {
    const { readFileText } = await import('./csv');
    expect(JSON.parse(await readFileText(new Blob(['\uFEFF{"a":1}'])))).toEqual({ a: 1 });
  });

  it('maps rows to header objects, padding short rows', () => {
    expect(csvToObjects('Name,Phone\nRavi')).toEqual([{ Name: 'Ravi', Phone: '' }]);
    expect(csvToObjects('only header')).toEqual([]);
  });
});

describe('validation', () => {
  it('normalises Indian phone formats', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
    expect(normalizePhone('919876543210')).toBe('9876543210');
    expect(isValidPhone('98765 43210')).toBe(true);
    expect(isValidPhone('12345')).toBe(false);
    expect(isValidPhone('+14155552671')).toBe(true);
  });

  it('validates GSTIN', () => {
    expect(isValidGstin('10AAKCN0009K1ZW')).toBe(true);
    expect(isValidGstin('10aakcn0009k1zw')).toBe(true);
    expect(isValidGstin('10AAKCN0009K1Z')).toBe(false);
  });

  it('reports required, range and line-item errors', () => {
    const leads = getEntity('leads')!;
    const errs = validateRecord(leads, { name: ' ', phone: 'abc', capacityKw: -1, status: 'Bogus' });
    expect(errs.name).toMatch(/required/);
    expect(errs.phone).toBeTruthy();
    expect(errs.capacityKw).toMatch(/at least 0/);
    expect(errs.status).toBeTruthy();

    const items = getEntity('invoices')!.fields.find((f) => f.key === 'items')!;
    expect(validateField(items, [{ description: '', qty: 1, rate: 1, gstRate: 0 }])).toMatch(/description/);
    expect(validateField(items, [{ description: 'x', qty: 0, rate: 1, gstRate: 0 }])).toMatch(/quantity/);
    expect(validateField(items, [])).toMatch(/required/);
  });

  it('accepts only real dates and whole numbers where required', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-02-31')).toBe(false);
    expect(isValidDate('2026-11-03T10:30')).toBe(true);
    expect(isValidDate('2026-11-03T25:30')).toBe(false);
    const tenure = getEntity('loans')!.fields.find((f) => f.key === 'tenureMonths')!;
    expect(validateField(tenure, 12.5)).toMatch(/whole number/);
    const amt = getEntity('expenses')!.fields.find((f) => f.key === 'amount')!;
    expect(validateField(amt, 1e15)).toMatch(/too large/);
  });

  it('reads booleans and blank numbers the way people type them', () => {
    const emp = getEntity('employees')!;
    expect(coerce(emp, { active: 'Yes' }).active).toBe(true);
    expect(coerce(emp, { active: 'TRUE' }).active).toBe(true);
    expect(coerce(emp, { active: 'No' }).active).toBe(false);
    expect(coerce(emp, { monthlySalary: '   ' }).monthlySalary).toBeNull();
    expect(coerce(emp, { monthlySalary: '₹ 25,000' }).monthlySalary).toBe(25000);
  });

  it('rejects junk phone numbers', () => {
    expect(isValidPhone('0000000000')).toBe(false);
    expect(isValidPhone('9999999999')).toBe(false);
    expect(isValidPhone('0612-2345678')).toBe(true);
  });

  it('rejects AMC end before start', () => {
    const amc = getEntity('amcs')!;
    expect(validateRecord(amc, { customerId: 'x', startDate: '2026-05-01', endDate: '2026-04-01', status: 'Active' }).endDate).toBeTruthy();
  });
});

describe('dates & links', () => {
  it('adds days across month and year ends', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('finds the next EMI date, clamping to month end', () => {
    expect(nextEmiDate('2026-01-31', '2026-02-10', 12)).toBe('2026-02-28');
    expect(nextEmiDate('2026-01-05', '2026-03-06', 12)).toBe('2026-04-05');
    expect(nextEmiDate('2026-01-05', '2027-06-01', 3)).toBeNull();
    expect(nextEmiDate('bad', '2026-01-01', 3)).toBeNull();
  });

  it('maps GSTIN codes and free text to states', () => {
    expect(stateFromGstin('10AAKCN0009K1ZW')).toBe('Bihar');
    expect(stateFromGstin('99XXXX')).toBeUndefined();
    expect(canonicalState(' bihar ')).toBe('Bihar');
    expect(canonicalState('BR')).toBeUndefined();
  });

  it('makes valid v4 UUIDs even without crypto.randomUUID (plain http)', () => {
    const real = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try { expect(uid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); }
    finally { Object.defineProperty(crypto, 'randomUUID', { value: real, configurable: true }); }
  });

  it('uses the local calendar day for timestamps', () => {
    expect(localDateOf('not a date')).toBe('not a date');
    const d = new Date(2026, 0, 1, 0, 30); // 00:30 local time on 1 Jan
    expect(localDateOf(d.toISOString())).toBe('2026-01-01');
    // A photo's time is stored as the local date and time (as typed in a date-time field), never UTC.
    expect(localDateTimeOf(new Date(2026, 10, 12, 19, 53, 40).toISOString())).toBe('2026-11-12T19:53');
    expect(localDateTimeOf(d.toISOString())).toBe('2026-01-01T00:30');
  });

  it('rejects damaged backups before restoring', () => {
    const ok = { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    expect(backupProblem({ leads: [ok] })).toBeNull();
    expect(backupProblem({ evil: [ok] })).toMatch(/unknown section/);
    expect(backupProblem({ leads: [{ ...ok, id: 'x' }] })).toMatch(/invalid id/);
    expect(backupProblem({ leads: [{ ...ok, createdAt: undefined }] })).toMatch(/creation date/);
    expect(backupProblem({ invoices: [{ ...ok, items: [null] }] })).toMatch(/line items/);
    expect(backupProblem({ leads: [ok, ok] })).toMatch(/twice/);
    expect(backupProblem(null)).toBeTruthy();
  });

  it('builds WhatsApp links', () => {
    expect(whatsappLink('98765 43210', 'Hi')).toBe('https://wa.me/919876543210?text=Hi');
    expect(whatsappLink('123')).toBeNull();
  });
});
