import type { LineItem } from './schema';
import { BRAND } from '../config/brand';

/** Rounds to paise, avoiding binary float drift (e.g. 1.005 -> 1.01). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100 || 0; // "|| 0": never -0, which prints as "-₹0.00"
}

/** Line value after the line's own discount % (before the document discount and GST). */
export function lineAmount(it: Partial<LineItem> | undefined): number {
  if (!it) return 0;
  const gross = (Number(it.qty) || 0) * (Number(it.rate) || 0);
  const pct = Math.min(Math.max(Number(it.discountPct) || 0, 0), 100);
  return gross * (1 - pct / 100);
}

export interface Totals {
  /** qty × rate, before any discount */
  gross: number;
  /** total of the per-line discounts */
  lineDiscount: number;
  /** after line discounts, before the document discount */
  subtotal: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  /** grand total rounded to the nearest rupee minus the exact total */
  roundOff: number;
  grandTotal: number;
}

/**
 * Discount is spread over lines in proportion to their value so GST is
 * charged on the discounted amount. Inter-state supply uses IGST,
 * intra-state splits the same tax into CGST + SGST.
 */
export function computeTotals(items: LineItem[] | undefined, discount = 0, interState = false): Totals {
  const lines = (Array.isArray(items) ? items : []).filter((it) => it && typeof it === 'object');
  const gross = round2(lines.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0));
  const rawSubtotal = lines.reduce((s, it) => s + lineAmount(it), 0);
  const subtotal = round2(rawSubtotal);
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  let rawTax = 0;
  for (const it of lines) {
    const lineValue = lineAmount(it);
    const share = rawSubtotal > 0 ? lineValue / rawSubtotal : 0;
    const lineTaxable = lineValue - disc * share;
    rawTax += lineTaxable * ((Number(it.gstRate) || 0) / 100);
  }
  const taxable = round2(subtotal - disc);
  let cgst = 0, sgst = 0, igst = 0, tax: number;
  if (interState) tax = igst = round2(rawTax);
  else {
    // CGST and SGST are always the same amount (half the rate each).
    cgst = sgst = round2(rawTax / 2);
    tax = round2(cgst + sgst);
  }
  const exact = round2(taxable + tax);
  const grandTotal = Math.round(exact);
  return { gross, lineDiscount: round2(gross - subtotal), subtotal, discount: round2(disc), taxable, cgst, sgst, igst, tax, roundOff: round2(grandTotal - exact), grandTotal };
}

export interface HsnRow { hsn: string; gstRate: number; taxable: number; tax: number; cgst: number; sgst: number; igst: number; qty: number; unit: string }

/** Rounds parts so they add up exactly to a total that was rounded on its own (largest remainder goes first). */
function allocate(raw: number[], total: number): number[] {
  const out = raw.map((v) => Math.round(v * 100) / 100);
  let diff = Math.round((total - out.reduce((a, b) => a + b, 0)) * 100);
  const order = raw.map((v, i) => ({ i, rem: v * 100 - Math.round(v * 100) })).sort((a, b) => (diff > 0 ? b.rem - a.rem : a.rem - b.rem));
  for (let k = 0; diff !== 0 && order.length; k = (k + 1) % order.length) {
    const step = diff > 0 ? 1 : -1;
    out[order[k].i] = Math.round((out[order[k].i] + step / 100) * 100) / 100;
    diff -= step;
  }
  return out.map((v) => v || 0); // never "-0"
}

/**
 * HSN-wise summary printed on tax invoices and in the HSN report (discount spread pro-rata, same as computeTotals).
 * The rows always add up to the invoice's own taxable value, CGST, SGST and IGST to the paisa.
 */
export function hsnSummary(items: LineItem[] | undefined, discount = 0, interState = false): HsnRow[] {
  const lines = (Array.isArray(items) ? items : []).filter((it) => it && typeof it === 'object');
  const subtotal = lines.reduce((s, it) => s + lineAmount(it), 0);
  const disc = Math.min(Math.max(Number(discount) || 0, 0), round2(subtotal));
  const map = new Map<string, { hsn: string; gstRate: number; taxable: number; tax: number; qty: number; unit: string }>();
  for (const it of lines) {
    const value = lineAmount(it);
    const taxable = value - (subtotal > 0 ? disc * (value / subtotal) : 0);
    const rate = Number(it.gstRate) || 0;
    const key = `${(it.hsn || '').trim() || '—'}|${rate}`;
    const row = map.get(key) || { hsn: (it.hsn || '').trim() || '—', gstRate: rate, taxable: 0, tax: 0, qty: 0, unit: String(it.unit || '') };
    row.taxable += taxable;
    row.tax += taxable * (rate / 100);
    row.qty += Number(it.qty) || 0;
    if (row.unit !== String(it.unit || '')) row.unit = row.unit ? 'Mixed' : String(it.unit || '');
    map.set(key, row);
  }
  const rows = [...map.values()];
  if (!rows.length) return [];
  const t = computeTotals(lines, discount, interState);
  const taxable = allocate(rows.map((r) => r.taxable), t.taxable);
  const half = allocate(rows.map((r) => (interState ? 0 : r.tax / 2)), t.cgst);
  const igst = allocate(rows.map((r) => (interState ? r.tax : 0)), t.igst);
  return rows.map((r, i) => ({
    hsn: r.hsn, gstRate: r.gstRate, qty: round2(r.qty), unit: r.unit, taxable: taxable[i],
    cgst: half[i], sgst: half[i], igst: igst[i], tax: round2(half[i] * 2 + igst[i]),
  }));
}

/** Indian financial year (April–March) for an ISO date, e.g. 2026-03-31 → "25-26", 2026-04-01 → "26-27". */
export function financialYear(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate || '');
  if (!m) return '';
  const y = Number(m[1]) - (Number(m[2]) < 4 ? 1 : 0);
  return `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** Standard reducing-balance EMI. Zero interest falls back to simple division. */
export function computeEmi(principal: number, annualRatePct: number, months: number): number {
  const p = Number(principal), m = Math.floor(Number(months));
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(m) || m <= 0) return 0;
  const r = (Number(annualRatePct) || 0) / 12 / 100;
  if (r <= 0) return round2(p / m);
  const f = Math.pow(1 + r, m);
  return round2((p * r * f) / (f - 1));
}

export interface EmiRow { n: number; date: string; emi: number; interest: number; principal: number; balance: number }

/** Month-by-month repayment table. The last EMI absorbs rounding so the balance ends at exactly 0. */
export function emiSchedule(principal: number, annualRatePct: number, months: number, firstDate = ''): EmiRow[] {
  const p = Number(principal), m = Math.floor(Number(months));
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(m) || m <= 0 || m > 600) return [];
  const r = (Number(annualRatePct) || 0) / 12 / 100;
  const emi = computeEmi(p, annualRatePct, m);
  const rows: EmiRow[] = [];
  let bal = p;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(firstDate);
  for (let n = 1; n <= m; n++) {
    const interest = round2(bal * r);
    let princ = round2(emi - interest);
    let pay = emi;
    if (n === m) { princ = round2(bal); pay = round2(princ + interest); }
    bal = round2(bal - princ);
    let date = '';
    if (ymd) {
      const y = Number(ymd[1]), mo = Number(ymd[2]) - 1 + (n - 1), d = Number(ymd[3]);
      const yy = y + Math.floor(mo / 12), mm = mo % 12;
      const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
      date = new Date(Date.UTC(yy, mm, Math.min(d, last))).toISOString().slice(0, 10);
    }
    rows.push({ n, date, emi: pay, interest, principal: princ, balance: Math.max(0, bal) });
  }
  return rows;
}

/** Rough yearly generation and savings for a rooftop system (shown on quotations as an estimate). */
export function solarEstimate(kw: number, unitsPerKwPerDay: number, tariff: number, cost: number) {
  const k = Number(kw), u = Number(unitsPerKwPerDay), t = Number(tariff), c = Number(cost);
  if (!(k > 0) || !(u > 0)) return null;
  const units = Math.round(k * u * 365);
  const savings = t > 0 ? round2(units * t) : 0;
  const payback = savings > 0 && c > 0 ? Math.round((c / savings) * 10) / 10 : null;
  return { units, savings, payback };
}

const fmt = new Intl.NumberFormat(BRAND.locale, { style: 'currency', currency: BRAND.currency, maximumFractionDigits: 2 });

export function money(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? fmt.format(Math.abs(v) < 0.005 ? 0 : v) : '—'; // a tiny or negative zero prints as ₹0.00
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}

/** Indian numbering (lakh / crore), used on invoices. */
export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return '';
  const rupees = Math.floor(round2(amount));
  const paise = Math.round(round2(amount - rupees) * 100);
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${crore >= 100 ? amountInWords(crore).replace(/ Rupees Only$/, '') : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  const words = parts.length ? parts.join(' ') : 'Zero';
  return paise ? `${words} Rupees and ${twoDigits(paise)} Paise Only` : `${words} Rupees Only`;
}
