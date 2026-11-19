// "Add custom filter": one field, a condition and a value, e.g. "System size (kW) ≥ 5",
// "Invoice date between 1 Apr and 30 Jun", "Assigned to is not set".
import type { Entity, Field, Rec } from '../lib/schema';
import type { Store } from '../lib/store';
import { formatDate } from '../lib/format';
import { money } from '../lib/money';
import { dayOf } from './filters';

export type Op = 'contains' | 'ncontains' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'set' | 'unset' | 'true' | 'false';
export interface CustomFilter { field: string; op: Op; value?: string; value2?: string }

export type Kind = 'text' | 'number' | 'money' | 'date' | 'choice' | 'bool';
export interface CustomField { key: string; label: string; kind: Kind; options?: { value: string; label: string }[]; computed?: boolean }

export const OP_LABELS: Record<Op, string> = {
  contains: 'contains', ncontains: 'does not contain', eq: 'is', neq: 'is not', gt: 'is more than', gte: 'is at least',
  lt: 'is less than', lte: 'is at most', between: 'is between', set: 'is set', unset: 'is not set', true: 'is yes', false: 'is no',
};
const SHORT: Partial<Record<Op, string>> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠' };

export const OPS: Record<Kind, Op[]> = {
  text: ['contains', 'ncontains', 'eq', 'neq', 'set', 'unset'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'set', 'unset'],
  money: ['gte', 'lte', 'gt', 'lt', 'between', 'eq', 'set', 'unset'],
  date: ['eq', 'lt', 'gt', 'between', 'set', 'unset'],
  choice: ['eq', 'neq', 'set', 'unset'],
  bool: ['true', 'false'],
};
export const NEEDS_VALUE = (op: Op) => !['set', 'unset', 'true', 'false'].includes(op);

function kindOf(f: Field): Kind | null {
  switch (f.type) {
    case 'text': case 'textarea': case 'email': case 'phone': case 'gstin': case 'pan': case 'pincode': return 'text';
    case 'number': case 'percent': return 'number';
    case 'money': return 'money';
    case 'date': case 'datetime': return 'date';
    case 'select': case 'ref': case 'user': return 'choice';
    case 'bool': return 'bool';
    default: return null;
  }
}

/** Fields that a custom filter can test, with their pick lists (records, people, options) filled in. */
export function customFields(store: Store, e: Entity): CustomField[] {
  const out: CustomField[] = [];
  if (e.numberPrefix) out.push({ key: 'number', label: 'Number', kind: 'text' });
  for (const f of e.fields) {
    if (f.hidden) continue;
    const kind = kindOf(f);
    if (!kind || /^(lat|lng|siteLat|siteLng)$/.test(f.key)) continue;
    let options: CustomField['options'];
    if (f.type === 'select') options = (f.options || []).map((o) => ({ value: o, label: o }));
    if (f.type === 'user') options = store.users.map((u) => ({ value: u.id, label: u.name }));
    if (f.type === 'ref') options = store.all(f.ref!).map((r) => ({ value: r.id, label: store.titleOf(f.ref!, r.id) })).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 500);
    out.push({ key: f.key, label: f.label, kind, options });
  }
  for (const c of e.computed || []) out.push({ key: c.key, label: c.label, kind: c.type === 'text' ? 'text' : c.type === 'money' ? 'money' : 'number', computed: true });
  out.push({ key: 'createdAt', label: 'Created on', kind: 'date' });
  return out;
}

function valueOf(store: Store, e: Entity, cf: CustomField, r: Rec): unknown {
  if (cf.computed) {
    const c = e.computed!.find((x) => x.key === cf.key)!;
    return c.type === 'text' ? store.computedText(e.key, r, c.key) : store.computed(e.key, r)[c.key];
  }
  return r[cf.key];
}

const empty = (v: unknown) => v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v));

export function testCustom(store: Store, e: Entity, fields: CustomField[], cf: CustomFilter, r: Rec): boolean {
  const def = fields.find((f) => f.key === cf.field);
  if (!def) return true; // a field that no longer exists does not hide everything
  const v = valueOf(store, e, def, r);
  if (cf.op === 'set') return !empty(v) && v !== false;
  if (cf.op === 'unset') return empty(v) || v === false;
  if (cf.op === 'true') return !!v;
  if (cf.op === 'false') return !v;
  if (empty(v)) return cf.op === 'neq' || cf.op === 'ncontains';
  const want = cf.value ?? '';
  if (def.kind === 'number' || def.kind === 'money') {
    const n = Number(v), a = Number(want), b = Number(cf.value2);
    if (!Number.isFinite(n) || !Number.isFinite(a)) return false;
    switch (cf.op) {
      case 'eq': return n === a; case 'neq': return n !== a;
      case 'gt': return n > a; case 'gte': return n >= a; case 'lt': return n < a; case 'lte': return n <= a;
      case 'between': return n >= Math.min(a, b) && n <= Math.max(a, b);
      default: return true;
    }
  }
  if (def.kind === 'date') {
    const d = dayOf(String(v));
    switch (cf.op) {
      case 'eq': return d === want; case 'lt': return d < want; case 'gt': return d > want;
      case 'between': { const [x, y] = [want, cf.value2 || want].sort(); return d >= x && d <= y; }
      default: return true;
    }
  }
  if (def.kind === 'choice') return cf.op === 'eq' ? String(v) === want : String(v) !== want;
  const text = String(v).toLowerCase(), w = want.toLowerCase();
  switch (cf.op) {
    case 'contains': return text.includes(w); case 'ncontains': return !text.includes(w);
    case 'eq': return text === w; case 'neq': return text !== w;
    default: return true;
  }
}

/** "System size (kW) ≥ 5", "Invoice date between 01 Apr 2026 and 30 Jun 2026", "Customer is Asha Devi". */
export function describeCustom(fields: CustomField[], cf: CustomFilter): { label: string; value: string } {
  const def = fields.find((f) => f.key === cf.field);
  const label = def?.label || cf.field;
  if (!NEEDS_VALUE(cf.op)) return { label, value: OP_LABELS[cf.op] };
  const show = (x?: string) => {
    if (x === undefined) return '';
    if (def?.kind === 'date') return formatDate(x);
    if (def?.kind === 'money') return money(Number(x));
    if (def?.options) return def.options.find((o) => o.value === x)?.label || x;
    return x;
  };
  if (cf.op === 'between') return { label, value: `between ${show(cf.value)} and ${show(cf.value2)}` };
  const sym = (def?.kind === 'number' || def?.kind === 'money') ? SHORT[cf.op] : undefined;
  return { label, value: `${sym || OP_LABELS[cf.op]} ${show(cf.value)}` };
}

/** In the address: field|op|value|value2, each part encoded (so a "|" typed in a value can never split it). */
export const encodeCustom = (c: CustomFilter) => [c.field, c.op, c.value ?? '', c.value2 ?? ''].map(encodeURIComponent).join('|');
export function decodeCustom(s: string): CustomFilter | null {
  const [field, op, value, value2] = s.split('|').map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  if (!field || !(op in OP_LABELS)) return null;
  return { field, op: op as Op, ...(value ? { value } : {}), ...(value2 ? { value2 } : {}) };
}
