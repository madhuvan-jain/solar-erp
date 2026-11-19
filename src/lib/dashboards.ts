// "My dashboard": a dashboard each person builds from items (KPI tiles, charts, tables, record lists, map,
// alerts, notes), placed on a 12-column grid and resized freely.
// One custom dashboard per person for now, kept on this device.
import type { Entity, Rec } from './schema';
import type { Store } from './store';
import { ENTITIES, getEntity } from '../modules/registry';
import { filtersFor, dayOf } from '../modules/filters';
import { searchRows, EMPTY_SEARCH } from '../modules/search';
import type { CustomFilter } from '../modules/customFilter';
import { aggregate, groupLabel, groupOptions, groupValue as groupValueOf, measureOptions, type GroupOpt, type MeasureOpt } from '../ui/components/Views';
import { canRead } from './rbac';
import { round2 } from './money';
import { todayIso } from './format';

export type ItemType = 'kpi' | 'chart' | 'table' | 'list' | 'map' | 'alerts' | 'note';
export type Agg = 'sum' | 'avg' | 'count';
export type ChartType = 'bar' | 'line' | 'donut' | 'hbar';
export type Period = 'month' | 'quarter' | 'fy' | 'year' | 'all';

export interface DashItem {
  id: string;
  type: ItemType;
  title: string;
  /** record type the numbers come from */
  entity?: string;
  /** '__count' or a money/number field or computed value */
  measure?: string;
  agg?: Agg;
  /** chart and table: one group; chart may split by a second */
  groupBy?: string;
  split?: string;
  chart?: ChartType;
  /** ready-made filters (filtersFor) and custom filters, as on the lists */
  filters?: string[];
  custom?: CustomFilter[];
  /** date field that follows the dashboard's period; empty = all time */
  dateField?: string;
  /** chart/table: keep the biggest N groups (the rest become "Other"); list: show N records */
  limit?: number;
  /** KPI goal, shown as a progress bar */
  target?: number;
  /** KPI: show the change against the period before */
  compare?: boolean;
  /** accent from the chart palette, 1–8 */
  color?: number;
  /** note text */
  text?: string;
  /** size on the 12-column grid: width 2–12 columns, height 1–6 rows */
  w: number;
  h: number;
}

export interface DashboardDef { version: 1; title: string; period: Period; items: DashItem[] }

const KEY = (userId: string) => `ss1:dash:${userId}`;

export function loadDashboard(userId: string): DashboardDef | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY(userId)) || 'null') as DashboardDef | null;
    return d && d.version === 1 && Array.isArray(d.items) ? { ...d, items: d.items.map(clampItem) } : null;
  } catch { return null; }
}

export function saveDashboard(userId: string, d: DashboardDef): void {
  try { localStorage.setItem(KEY(userId), JSON.stringify(d)); }
  catch { throw new Error('Could not save the dashboard on this device (storage is full or blocked).'); }
}

export function deleteDashboard(userId: string): void {
  try { localStorage.removeItem(KEY(userId)); } catch { /* nothing to remove */ }
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
/** Widths 2–12 columns, heights 1–6 rows; a missing size gets a medium default. */
export const clampItem = (it: DashItem): DashItem => ({ ...it, w: Math.min(12, Math.max(2, Math.round(num(it.w, 4)))), h: Math.min(6, Math.max(1, Math.round(num(it.h, 2)))) });

let seq = 0;
export const newId = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Sensible starting size for each kind of item. */
export const DEFAULT_SIZE: Record<ItemType, { w: number; h: number }> = {
  kpi: { w: 3, h: 1 }, chart: { w: 6, h: 3 }, table: { w: 4, h: 3 }, list: { w: 4, h: 3 }, map: { w: 8, h: 4 }, alerts: { w: 4, h: 4 }, note: { w: 4, h: 1 },
};

/** A solar business starting point: the money, the pipeline, the work and where customers are. */
export function solarTemplate(): DashboardDef {
  const k = (title: string, entity: string, measure: string, agg: Agg, extra: Partial<DashItem> = {}): DashItem =>
    ({ id: newId(), type: 'kpi', title, entity, measure, agg, compare: true, ...DEFAULT_SIZE.kpi, ...extra });
  const c = (title: string, entity: string, measure: string, agg: Agg, groupBy: string, chart: ChartType, extra: Partial<DashItem> = {}): DashItem =>
    ({ id: newId(), type: 'chart', title, entity, measure, agg, groupBy, chart, ...DEFAULT_SIZE.chart, ...extra });
  return {
    version: 1, title: 'My dashboard', period: 'fy',
    items: [
      // Drafts and cancelled invoices are not sales, as on the default dashboard and in Reports.
      k('Invoiced', 'invoices', 'grandTotal', 'sum', { dateField: 'date', color: 1, filters: ['issued'] }),
      k('Collected', 'payments', 'amount', 'sum', { dateField: 'date', color: 3 }),
      k('Still to collect', 'invoices', 'balance', 'sum', { filters: ['pay:unpaid', 'pay:part'], compare: false, color: 8 }),
      k('Open leads', 'leads', '__count', 'count', { filters: ['open'], compare: false, color: 2 }),
      c('Invoiced by month', 'invoices', 'grandTotal', 'sum', 'date', 'line', { dateField: 'date', w: 8, filters: ['issued'] }),
      c('Leads by source', 'leads', '__count', 'count', 'source', 'donut', { w: 4 }),
      c('Pipeline by stage', 'leads', '__count', 'count', 'status', 'hbar', { filters: ['open'] }),
      { id: newId(), type: 'table', title: 'Top customers by invoicing', entity: 'invoices', measure: 'grandTotal', agg: 'sum', groupBy: 'customerId', limit: 8, dateField: 'date', filters: ['issued'], w: 6, h: 3 },
      { id: newId(), type: 'map', title: 'Customers across India', entity: 'customers', measure: '__count', agg: 'count', w: 8, h: 4 },
      { id: newId(), type: 'alerts', title: 'Needs attention', w: 4, h: 4 },
    ],
  };
}

export const emptyDashboard = (): DashboardDef => ({ version: 1, title: 'My dashboard', period: 'fy', items: [] });

// ---------------------------------------------------------------- numbers for an item

export interface Range { from: string; to: string; prevFrom: string; prevTo: string }

export function measureList(e: Entity): MeasureOpt[] { return measureOptions(e); }
export function groupList(e: Entity): GroupOpt[] {
  const base = groupOptions(e);
  return e.fields.some((f) => f.key === 'city' && !f.hidden) ? [...base, { key: 'city', label: 'City', kind: 'field' }] : base;
}
export function dateFields(e: Entity) {
  return [...e.fields.filter((f) => !f.hidden && (f.type === 'date' || f.type === 'datetime')).map((f) => ({ key: f.key, label: f.label })), { key: 'createdAt', label: 'Created on' }];
}

const inRange = (d: string, from: string, to: string) => !!d && d >= from && d <= to;

/** The records an item counts: its filters, then the period on its date field (when it follows the period). */
export function itemRows(store: Store, it: DashItem, range: Range | null, prev = false): Rec[] {
  const e = it.entity ? getEntity(it.entity) : undefined;
  if (!e) return [];
  const ctx = { store, me: store.user?.id || '', today: todayIso(), companyState: store.companyState() };
  const known = new Set(filtersFor(e).map((f) => f.key));
  let rows = searchRows(store, e, store.all(e.key), { ...EMPTY_SEARCH, f: (it.filters || []).filter((k) => known.has(k)), c: it.custom || [] }, ctx);
  if (it.dateField && range) {
    const [from, to] = prev ? [range.prevFrom, range.prevTo] : [range.from, range.to];
    rows = rows.filter((r) => inRange(dayOf(r[it.dateField!]), from, to));
  }
  return rows;
}

function measureOf(e: Entity, it: DashItem): MeasureOpt {
  const list = measureOptions(e);
  return list.find((m) => m.key === it.measure) || list[0];
}

/** Sum, average or count of the item's measure over some records. */
export function total(store: Store, it: DashItem, rows: Rec[]): number {
  const e = getEntity(it.entity || '');
  if (!e) return 0;
  const m = measureOf(e, it);
  if (m.key === '__count' || it.agg === 'count') return rows.length;
  const values = rows.map((r) => {
    const c = e.computed?.find((x) => x.key === m.key);
    const n = c ? store.computed(e.key, r)[m.key] : Number(r[m.key]);
    return Number.isFinite(n) ? n : 0;
  });
  const sum = values.reduce((s, v) => s + v, 0);
  return round2(it.agg === 'avg' ? (values.length ? sum / values.length : 0) : sum);
}

export function isMoney(it: DashItem): boolean {
  const e = getEntity(it.entity || '');
  return !!e && it.agg !== 'count' && measureOf(e, it).money;
}

export interface ItemData { labels: string[]; series: { name: string; values: number[] }[]; total: number }

/** Chart / table numbers: grouped (and optionally split), biggest first where order is free, "Other" past the limit. */
export function itemSeries(store: Store, it: DashItem, rows: Rec[]): ItemData {
  const e = getEntity(it.entity || '');
  if (!e) return { labels: [], series: [], total: 0 };
  const groups = groupList(e);
  const g = groups.find((x) => x.key === it.groupBy) || groups[0];
  const split = it.split ? groups.find((x) => x.key === it.split && x.key !== g.key) : undefined;
  const m0 = measureOf(e, it);
  const m: MeasureOpt = it.agg === 'count' ? { key: '__count', label: 'Count', money: false } : m0;
  const agg = aggregate(store, e, rows, g, m, split);
  let keys = agg.rowKeys;
  const timeOrdered = g.kind === 'month' || g.kind === 'quarter' || g.kind === 'year';
  const fieldDef = e.fields.find((f) => f.key === g.key);
  if (!timeOrdered && fieldDef?.type !== 'select') keys = [...keys].sort((a, b) => (agg.rowTotals.get(b) || 0) - (agg.rowTotals.get(a) || 0));
  const limit = it.limit && it.limit > 0 ? it.limit : timeOrdered ? 24 : 12;
  const shown = keys.length > limit ? (timeOrdered ? keys.slice(-limit) : keys.slice(0, limit - 1)) : keys;
  // An average of "everything else" means nothing, so averages simply show the top groups.
  const rest = timeOrdered || it.agg === 'avg' ? [] : keys.filter((k) => !shown.includes(k));
  // An average divides each cell by the records in that cell (group and, when split, that split value).
  const avg = (k: string, c: string) => {
    if (it.agg !== 'avg') return agg.cells.get(k)?.get(c) || 0;
    const n = rows.filter((r) => groupValueOf(store, e, g, r) === k && (!split || groupValueOf(store, e, split, r) === c)).length;
    return n ? (agg.cells.get(k)?.get(c) || 0) / n : 0;
  };
  const cols = agg.colKeys;
  const labels = [...shown.map((k) => groupLabel(g, k)), ...(rest.length ? ['Other'] : [])];
  const series = cols.map((c) => ({
    name: split ? groupLabel(split, c) : m.label,
    values: [...shown.map((k) => round2(avg(k, c))), ...(rest.length ? [round2(rest.reduce((s, k) => s + (agg.cells.get(k)?.get(c) || 0), 0))] : [])],
  }));
  return { labels, series, total: agg.total };
}

/** What a new item starts with: money invoiced for people who see Finance, else a count of the first records they can see. */
export function firstItemData(store: Store): Partial<DashItem> {
  if (canRead(store.user, 'finance')) return { entity: 'invoices', measure: 'grandTotal', agg: 'sum', groupBy: 'date', chart: 'bar', dateField: 'date', filters: ['issued'] };
  const e = ENTITIES.find((x) => canRead(store.user, x.module));
  if (!e) return { type: 'note', text: '' };
  const df = dateFields(e)[0]?.key || 'createdAt';
  return { entity: e.key, measure: '__count', agg: 'count', groupBy: groupList(e)[0]?.key, chart: 'bar', dateField: df };
}

/** Can this person see the item's data at all? */
export function itemAllowed(store: Store, it: DashItem): boolean {
  if (!it.entity) return true;
  const e = getEntity(it.entity);
  return !!e && canRead(store.user, e.module);
}
