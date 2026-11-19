// A list's records as an export table: one column per visible field with its real type, so Excel gets
// numbers, money and dates, and phone numbers read as "98765 43210" (no "+" that spreadsheets mistake for a formula).
import type { Entity, Field, Rec } from '../lib/schema';
import type { Store } from '../lib/store';
import type { Cell, ColType, ExportTable } from '../lib/exporters';
import { plainValue } from './search';
import { localDateOf } from '../lib/format';

const TYPE: Partial<Record<Field['type'], ColType>> = { money: 'money', number: 'number', date: 'date', datetime: 'datetime' };

function cell(store: Store, f: Field, r: Rec): Cell {
  const v = r[f.key];
  if (v === undefined || v === null || v === '') return null;
  if (f.type === 'money' || f.type === 'number') { const n = Number(v); return Number.isFinite(n) ? n : String(v); }
  if (f.type === 'phone') {
    const s = String(v), d = s.replace(/\D/g, '');
    const ten = d.length === 10 ? d : d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : '';
    return ten ? `${ten.slice(0, 5)} ${ten.slice(5)}` : s;
  }
  if (f.type === 'date' || f.type === 'datetime') return String(v);
  return plainValue(store, f, r);
}

export function entityTable(store: Store, entity: Entity, rows: Rec[], subtitle?: string): ExportTable {
  const fields = entity.fields.filter((f) => f.type !== 'items' && f.type !== 'file' && !f.hidden);
  const comps = entity.computed || [];
  const numbered = !!entity.numberPrefix;
  const columns = [
    ...(numbered ? [{ label: 'Number', type: 'text' as const }] : []),
    ...fields.map((f) => ({ label: f.label, type: TYPE[f.type] || 'text' as ColType })),
    ...comps.map((c) => ({ label: c.label, type: (c.type === 'text' ? 'text' : c.type) as ColType })),
    { label: 'Created', type: 'date' as const },
  ];
  const data = rows.map((r) => {
    const c = store.computed(entity.key, r);
    return [
      ...(numbered ? [r.number || ''] : []),
      ...fields.map((f) => cell(store, f, r)),
      ...comps.map((x) => (x.type === 'text' ? store.computedText(entity.key, r, x.key) : c[x.key] ?? null)),
      localDateOf(r.createdAt),
    ];
  });
  const sums = comps.filter((x) => x.type === 'money');
  // Per-unit rates (a product's price or cost) are never added up.
  const rateCols = new Set(fields.map((f, i) => (f.noTotal ? i + (numbered ? 1 : 0) : -1)).filter((i) => i >= 0));
  const moneyFields = fields.filter((f) => f.type === 'money' && !f.noTotal);
  const totals = rows.length > 1 && (sums.length || moneyFields.length)
    ? columns.map((col, i) => {
      if (i === 0) return 'Total';
      return col.type === 'money' && !rateCols.has(i) ? Math.round(data.reduce((s, r) => s + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0) * 100) / 100 : null;
    })
    : undefined;
  return {
    title: entity.plural,
    subtitle: subtitle ?? `${rows.length} record(s)`,
    company: String(store.settings().companyName || ''),
    columns, rows: data, totals,
  };
}
