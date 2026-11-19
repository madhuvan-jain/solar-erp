// One place that decides which records a list shows, so the list, its counts and its exports always agree.
import type { Entity, Field, Rec } from '../lib/schema';
import type { Store } from '../lib/store';
import { applyFilters, filtersFor, type FilterCtx } from './filters';
import { customFields, testCustom, type CustomFilter } from './customFilter';

/** What a list is showing: free text, ready-made filters, field searches ("City: Patna"), custom filters and grouping. */
export interface SearchState { q: string; f: string[]; s: { field: string; value: string }[]; c: CustomFilter[]; g: string[] }

export const EMPTY_SEARCH: SearchState = { q: '', f: [], s: [], c: [], g: [] };

/** Plain-text value used for search, sort and CSV export. */
export function plainValue(store: Store, f: Field, r: Rec): string {
  const v = r[f.key];
  if (v === undefined || v === null) return '';
  if (f.type === 'ref') return store.get(f.ref!, v) ? store.titleOf(f.ref!, v) : '';
  if (f.type === 'user') return store.userName(v);
  if (f.type === 'file') return (v as { name?: string }).name || '';
  if (f.type === 'checklist') return Array.isArray(v) ? v.join('; ') : '';
  if (f.type === 'items') return `${Array.isArray(v) ? v.length : 0} line(s)`;
  if (f.type === 'bool') return v ? 'Yes' : 'No';
  return String(v);
}

/**
 * The records that match. `skipSection` leaves out one filter section — used for the live counts:
 * "how many would I see if I also ticked this one?"
 */
export function searchRows(store: Store, entity: Entity, list: Rec[], st: SearchState, ctx: FilterCtx, skipSection?: string): Rec[] {
  const keys = skipSection ? st.f.filter((k) => filtersFor(entity).find((d) => d.key === k)?.section !== skipSection) : st.f;
  let rows = applyFilters(entity, list, keys, ctx);
  for (const t of st.s) {
    const want = t.value.toLowerCase();
    const f = entity.fields.find((x) => x.key === t.field);
    rows = rows.filter((r) => (t.field === 'number' ? String(r.number || '') : f ? plainValue(store, f, r) : '').toLowerCase().includes(want));
  }
  if (st.c.length) {
    const defs = customFields(store, entity);
    rows = rows.filter((r) => st.c.every((c) => testCustom(store, entity, defs, c, r)));
  }
  const needle = st.q.trim().toLowerCase();
  if (needle) {
    rows = rows.filter((r) =>
      String(r.number || '').toLowerCase().includes(needle) ||
      (entity.computed || []).some((c) => c.type === 'text' && store.computedText(entity.key, r, c.key).toLowerCase().includes(needle)) ||
      entity.fields.some((f) => plainValue(store, f, r).toLowerCase().includes(needle)));
  }
  return rows;
}
