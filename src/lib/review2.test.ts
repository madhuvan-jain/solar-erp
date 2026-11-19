// Second A–Z review: GST printing maths, state codes and CSV import edge cases.
import { describe, expect, it } from 'vitest';
import { computeTotals, hsnSummary } from './money';
import { stateCode, stateWithCode } from './states';
import { EXTRA, csvToObjects, parseCsv } from './csv';

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('HSN summary always adds up to the invoice totals', () => {
  it('₹100.10 at 5%: CGST 2.50 + SGST 2.50 in the totals and in the HSN rows', () => {
    const items = [{ description: 'x', hsn: '8541', qty: 1, rate: 100.1, gstRate: 5 }];
    const t = computeTotals(items, 0, false);
    const rows = hsnSummary(items, 0, false);
    expect([t.cgst, t.sgst]).toEqual([2.5, 2.5]);
    expect(rows[0]).toMatchObject({ cgst: 2.5, sgst: 2.5, tax: 5, taxable: 100.1 });
  });

  it('random mixed-rate invoices: rows match totals to the paisa, intra- and inter-state', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let n = 0; n < 300; n++) {
      const items = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => ({
        description: 'x', hsn: ['8541', '8504', '9954'][i % 3], qty: Math.round(rnd() * 20 * 100) / 100 || 1,
        rate: Math.round(rnd() * 5000 * 100) / 100, gstRate: [5, 12, 18, 28][Math.floor(rnd() * 4)], discountPct: Math.floor(rnd() * 3) * 5,
      }));
      const disc = Math.round(rnd() * 300 * 100) / 100;
      for (const inter of [false, true]) {
        const t = computeTotals(items, disc, inter);
        const rows = hsnSummary(items, disc, inter);
        expect(sum(rows.map((r) => r.taxable))).toBe(t.taxable);
        expect(sum(rows.map((r) => r.cgst))).toBe(t.cgst);
        expect(sum(rows.map((r) => r.sgst))).toBe(t.sgst);
        expect(sum(rows.map((r) => r.igst))).toBe(t.igst);
        expect(sum(rows.map((r) => r.tax))).toBe(t.tax);
      }
    }
  });

  it('carries quantity and unit for the GSTR-1 HSN summary', () => {
    const rows = hsnSummary([
      { description: 'a', hsn: '8541', qty: 10, rate: 100, gstRate: 5, unit: 'Nos' },
      { description: 'b', hsn: '8541', qty: 2, rate: 100, gstRate: 5, unit: 'Nos' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qty: 12, unit: 'Nos' });
  });
});

describe('state codes on tax invoices', () => {
  it('prints "07 - Delhi" style names', () => {
    expect(stateCode('Delhi')).toBe('07');
    expect(stateWithCode(' bihar ')).toBe('10 - Bihar');
    expect(stateWithCode('Unknownland')).toBe('Unknownland');
  });
});

describe('CSV import', () => {
  it('a quoted field after a space is one field (no shifted columns)', () => {
    expect(parseCsv('Name, City\nRavi, "Patna, Bihar"\n')).toEqual([['Name', ' City'], ['Ravi', 'Patna, Bihar']]);
  });

  it('flags rows that have more cells than headers', () => {
    const [ok, bad] = csvToObjects('Name,City\nRavi,Patna\nAsha,Gaya,Bihar\n');
    expect(ok[EXTRA]).toBeUndefined();
    expect(bad[EXTRA]).toBe('1');
  });
});
