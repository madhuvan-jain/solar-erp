import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Entity, Field, Rec } from '../../lib/schema';
import type { Store } from '../../lib/store';
import { useStore } from '../../lib/store';
import { money, round2 } from '../../lib/money';
import { localDateOf, todayIso } from '../../lib/format';
import { downloadText, toCsv } from '../../lib/csv';
import { Chart, type ChartKind } from './Charts';
import { StatusBadge } from './FieldValue';

// ---------------- grouping & measures (shared by pivot and graph) ----------------

/** `month`, `quarter` and `year` group a date field (`field`) by calendar month and by India's April–March financial year. */
export interface GroupOpt { key: string; label: string; kind: 'field' | 'month' | 'quarter' | 'year' | 'computed'; field?: string }
export interface MeasureOpt { key: string; label: string; money: boolean }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : ym);
const isTime = (g: GroupOpt) => g.kind === 'month' || g.kind === 'quarter' || g.kind === 'year';
/** Text shown for a group value (months as "Nov 2026"; quarters and years are already readable). */
export const groupLabel = (g: GroupOpt, v: string) => (g.kind === 'month' ? monthLabel(v) : v);

/** "2026-11-05" → financial year "FY 2026-27" and quarter "FY 2026-27 Q3" (Q1 = April–June). Sorts in time order. */
function fyOf(day: string): { fy: string; q: number } {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return { fy: `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`, q: Math.floor(((m + 8) % 12) / 3) + 1 };
}

export function groupOptions(entity: Entity): GroupOpt[] {
  const out: GroupOpt[] = [];
  for (const f of entity.fields) {
    if (f.hidden) continue;
    if (['select', 'user', 'ref', 'bool'].includes(f.type)) out.push({ key: f.key, label: f.label, kind: 'field' });
    else if (f.type === 'date' || f.type === 'datetime') {
      out.push({ key: f.key, label: `${f.label} (month)`, kind: 'month', field: f.key });
      out.push({ key: `${f.key}:quarter`, label: `${f.label} (quarter)`, kind: 'quarter', field: f.key });
      out.push({ key: `${f.key}:year`, label: `${f.label} (financial year)`, kind: 'year', field: f.key });
    }
  }
  for (const c of entity.computed || []) if (c.type === 'text') out.push({ key: c.key, label: c.label, kind: 'computed' });
  out.push({ key: 'createdAt', label: 'Created (month)', kind: 'month', field: 'createdAt' });
  out.push({ key: 'createdAt:year', label: 'Created (financial year)', kind: 'year', field: 'createdAt' });
  return out;
}

export function measureOptions(entity: Entity): MeasureOpt[] {
  const out: MeasureOpt[] = [{ key: '__count', label: 'Count', money: false }];
  for (const c of entity.computed || []) if (c.type !== 'text') out.push({ key: c.key, label: c.label, money: c.type === 'money' });
  for (const f of entity.fields) {
    if (!f.hidden && ['money', 'number'].includes(f.type) && !/lat|lng|rating/i.test(f.key)) out.push({ key: f.key, label: f.label, money: f.type === 'money' });
  }
  return out;
}

const NONE = '(none)';

export function groupValue(store: Store, entity: Entity, g: GroupOpt, r: Rec): string {
  if (g.kind === 'computed') return store.computedText(entity.key, r, g.key) || NONE;
  const v = r[g.field || g.key];
  if (isTime(g)) {
    if (!v) return NONE;
    const s = String(v);
    const day = s.length > 16 ? localDateOf(s) : s.slice(0, 10);
    if (g.kind === 'month') return day.slice(0, 7);
    const { fy, q } = fyOf(day);
    return g.kind === 'year' ? fy : `${fy} Q${q}`;
  }
  const f = entity.fields.find((x) => x.key === g.key) as Field;
  if (v === undefined || v === null || v === '') return f.type === 'bool' ? 'No' : NONE;
  if (f.type === 'ref') return store.get(f.ref!, v) ? store.titleOf(f.ref!, v) : NONE;
  if (f.type === 'user') return store.userName(v);
  if (f.type === 'bool') return v ? 'Yes' : 'No';
  return String(v);
}

export function measureValue(store: Store, entity: Entity, m: MeasureOpt, r: Rec): number {
  if (m.key === '__count') return 1;
  const c = entity.computed?.find((x) => x.key === m.key);
  const n = c ? store.computed(entity.key, r)[m.key] : Number(r[m.key]);
  return Number.isFinite(n) ? n : 0;
}

/** Orders groups: months chronologically, select options in their defined order, others by size. */
export function orderGroups(entity: Entity, g: GroupOpt, keys: string[], size: Map<string, number>): string[] {
  const f = entity.fields.find((x) => x.key === g.key);
  if (isTime(g)) return [...keys].sort((a, b) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b)));
  if (f?.type === 'select' && f.options) return [...keys].sort((a, b) => {
    const ia = f.options!.indexOf(a), ib = f.options!.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  return [...keys].sort((a, b) => (size.get(b) || 0) - (size.get(a) || 0) || a.localeCompare(b));
}

export function aggregate(store: Store, entity: Entity, rows: Rec[], g: GroupOpt, m: MeasureOpt, col?: GroupOpt) {
  const cells = new Map<string, Map<string, number>>();
  const rowTotals = new Map<string, number>(), colTotals = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const rk = groupValue(store, entity, g, r);
    const ck = col ? groupValue(store, entity, col, r) : 'Total';
    const v = measureValue(store, entity, m, r);
    if (!cells.has(rk)) cells.set(rk, new Map());
    cells.get(rk)!.set(ck, (cells.get(rk)!.get(ck) || 0) + v);
    rowTotals.set(rk, (rowTotals.get(rk) || 0) + v);
    colTotals.set(ck, (colTotals.get(ck) || 0) + v);
    total += v;
  }
  const rowKeys = orderGroups(entity, g, [...rowTotals.keys()], rowTotals);
  const colKeys = col ? orderGroups(entity, col, [...colTotals.keys()], colTotals) : ['Total'];
  return { cells, rowTotals, colTotals, total: round2(total), rowKeys, colKeys };
}

function pick<T extends { key: string }>(list: T[], key: string | null, fallback: T): T {
  return list.find((x) => x.key === key) || fallback;
}

function defaultGroup(entity: Entity, groups: GroupOpt[]): GroupOpt {
  return groups.find((g) => g.key === entity.statusField) || groups.find((g) => g.kind === 'field') || groups[0];
}

/** A document total when there is one (invoices, quotations…), otherwise a simple count. */
function defaultMeasure(entity: Entity, measures: MeasureOpt[]): MeasureOpt {
  const total = entity.computed?.find((c) => c.key === 'grandTotal');
  return (total && measures.find((m) => m.key === total.key)) || measures[0];
}

function Select({ label, value, options, onChange, allowNone }: { label: string; value: string; options: { key: string; label: string }[]; onChange: (v: string) => void; allowNone?: boolean }) {
  const id = 'vs-' + label.replace(/\W+/g, '-').toLowerCase();
  return (
    <span className="inline-field">
      <label htmlFor={id} className="small muted">{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value="">—</option>}
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </span>
  );
}

// ---------------- pivot ----------------

/** `initialRows` / `initialCols`: the list's own "Group by", so switching to Pivot keeps the same split. */
export function PivotView({ entity, rows, initialRows, initialCols }: { entity: Entity; rows: Rec[]; initialRows?: string; initialCols?: string }) {
  const store = useStore();
  const groups = useMemo(() => groupOptions(entity), [entity]);
  const measures = useMemo(() => measureOptions(entity), [entity]);
  const [gk, setGk] = useState(groups.find((x) => x.key === initialRows)?.key || defaultGroup(entity, groups).key);
  const [ck, setCk] = useState(groups.find((x) => x.key === initialCols && x.key !== initialRows)?.key || '');
  const [mk, setMk] = useState(defaultMeasure(entity, measures).key);
  const g = pick(groups, gk, groups[0]);
  const col = ck ? groups.find((x) => x.key === ck) : undefined;
  const m = pick(measures, mk, measures[0]);
  const agg = useMemo(() => aggregate(store, entity, rows, g, m, col), [store, entity, rows, g, m, col]);
  const fmt = (n: number) => (m.money ? money(n) : String(round2(n)));
  const lab = (k: string, grp: GroupOpt) => groupLabel(grp, k);

  const exportCsv = () => {
    const header = [g.label, ...agg.colKeys.map((c) => (col ? lab(c, col) : m.label)), ...(col ? ['Total'] : [])];
    const data = agg.rowKeys.map((rk) => [lab(rk, g), ...agg.colKeys.map((c) => round2(agg.cells.get(rk)?.get(c) || 0)), ...(col ? [round2(agg.rowTotals.get(rk) || 0)] : [])]);
    data.push(['Total', ...agg.colKeys.map((c) => round2(agg.colTotals.get(c) || 0)), ...(col ? [agg.total] : [])]);
    downloadText(`${entity.key}-pivot-${todayIso()}.csv`, toCsv(header, data));
  };

  return (
    <div className="card">
      <div className="toolbar">
        <Select label="Rows" value={g.key} options={groups} onChange={setGk} />
        <Select label="Columns" value={ck} options={groups.filter((x) => x.key !== g.key)} onChange={setCk} allowNone />
        <Select label="Measure" value={m.key} options={measures} onChange={setMk} />
        <button className="btn sm" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>
      {!rows.length ? <p className="muted">No records to analyse.</p> : (
        <div className="table-wrap">
          <table className="pivot">
            <thead>
              <tr><th>{g.label}{col ? ` ↓ / ${col.label} →` : ''}</th>{agg.colKeys.map((c) => <th key={c} className="num">{col ? lab(c, col) : m.label}</th>)}{col && <th className="num">Total</th>}</tr>
            </thead>
            <tbody>
              {agg.rowKeys.map((rk) => (
                <tr key={rk}>
                  <td>{lab(rk, g)}</td>
                  {agg.colKeys.map((c) => <td key={c} className="num">{agg.cells.get(rk)?.has(c) ? fmt(agg.cells.get(rk)!.get(c)!) : ''}</td>)}
                  {col && <td className="num"><strong>{fmt(agg.rowTotals.get(rk) || 0)}</strong></td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th>Total</th>{agg.colKeys.map((c) => <th key={c} className="num">{fmt(agg.colTotals.get(c) || 0)}</th>)}{col && <th className="num">{fmt(agg.total)}</th>}</tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- graph ----------------

export function GraphView({ entity, rows, initialGroup, initialSplit }: { entity: Entity; rows: Rec[]; initialGroup?: string; initialSplit?: string }) {
  const store = useStore();
  const groups = useMemo(() => groupOptions(entity), [entity]);
  const measures = useMemo(() => measureOptions(entity), [entity]);
  const [gk, setGk] = useState(groups.find((x) => x.key === initialGroup)?.key || defaultGroup(entity, groups).key);
  const [sk, setSk] = useState(groups.find((x) => x.key === initialSplit && x.key !== initialGroup)?.key || '');
  const [mk, setMk] = useState(defaultMeasure(entity, measures).key);
  const [kind, setKind] = useState<ChartKind>('bar');
  const g = pick(groups, gk, groups[0]);
  const split = sk ? groups.find((x) => x.key === sk) : undefined;
  const m = pick(measures, mk, measures[0]);
  const data = useMemo(() => {
    const agg = aggregate(store, entity, rows, g, m, split);
    // Eight series at most; the rest fold into “Other” so colours never repeat.
    let cols = agg.colKeys;
    let other: string[] = [];
    if (cols.length > 8) { other = cols.slice(7); cols = [...cols.slice(0, 7), 'Other']; }
    const labels = agg.rowKeys.map((k) => groupLabel(g, k));
    const series = cols.map((c) => ({
      name: split ? groupLabel(split, c) : m.label,
      values: agg.rowKeys.map((rk) => round2(c === 'Other' && other.length
        ? other.reduce((s, o) => s + (agg.cells.get(rk)?.get(o) || 0), 0)
        : agg.cells.get(rk)?.get(c) || 0)),
    }));
    return { labels, series };
  }, [store, entity, rows, g, m, split]);
  const fmt = (n: number) => (m.money ? money(n) : String(round2(n)));
  const kinds: ChartKind[] = split ? ['bar', 'line'] : ['bar', 'line', 'donut', 'hbar'];
  const k = kinds.includes(kind) ? kind : 'bar';

  return (
    <div className="card">
      <div className="toolbar">
        <Select label="Group by" value={g.key} options={groups} onChange={setGk} />
        <Select label="Split by" value={sk} options={groups.filter((x) => x.key !== g.key)} onChange={setSk} allowNone />
        <Select label="Measure" value={m.key} options={measures} onChange={setMk} />
        <div className="seg" role="group" aria-label="Chart type">
          {kinds.map((x) => <button key={x} type="button" className={k === x ? 'on' : ''} aria-pressed={k === x} onClick={() => setKind(x)}>{({ bar: 'Bar', line: 'Line', donut: 'Donut', hbar: 'Bars' } as const)[x]}</button>)}
        </div>
      </div>
      {!rows.length ? <p className="muted">No records to chart.</p> : <Chart data={data} kind={k} format={fmt} height={300} />}
    </div>
  );
}

// ---------------- calendar ----------------

export function calendarField(entity: Entity): Field | undefined {
  return entity.fields.find((f) => f.key === entity.calendarField)
    || entity.fields.find((f) => (f.type === 'date' || f.type === 'datetime') && f.list && !f.hidden)
    || entity.fields.find((f) => (f.type === 'date' || f.type === 'datetime') && !f.hidden);
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarView({ entity, rows, field }: { entity: Entity; rows: Rec[]; field: Field }) {
  const store = useStore();
  const today = todayIso();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [y, mo] = ym.split('-').map(Number);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, mo - 1 + n, 1));
    setYm(d.toISOString().slice(0, 7));
  };
  const byDay = useMemo(() => {
    const map = new Map<string, Rec[]>();
    for (const r of rows) {
      const v = r[field.key];
      if (!v) continue;
      const d = String(v).length > 10 && field.type === 'datetime' ? String(v).slice(0, 10) : String(v).slice(0, 10);
      if (!d.startsWith(ym)) continue;
      map.set(d, [...(map.get(d) || []), r]);
    }
    return map;
  }, [rows, field, ym]);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const statusF = entity.fields.find((f) => f.key === entity.statusField);
  const count = [...byDay.values()].reduce((s, l) => s + l.length, 0);
  const undated = rows.filter((r) => !r[field.key]).length;

  return (
    <div className="card">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <div className="btn-row">
          <button className="btn sm" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <button className="btn sm" onClick={() => setYm(today.slice(0, 7))}>Today</button>
          <button className="btn sm" onClick={() => shift(1)} aria-label="Next month">›</button>
        </div>
        <h2 style={{ margin: 0 }}>{monthLabel(ym)}</h2>
        <span className="muted small">{count} by {field.label.toLowerCase()}{undated ? ` · ${undated} without a date` : ''}</span>
      </div>
      <div className="cal" role="grid" aria-label={`${entity.plural} in ${monthLabel(ym)}`}>
        {WEEKDAYS.map((d) => <div key={d} className="cal-wd" role="columnheader">{d}</div>)}
        {cells.map((d, i) => {
          const list = d ? byDay.get(d) || [] : [];
          return (
            <div key={i} role="gridcell" className={'cal-day' + (!d ? ' off' : '') + (d === today ? ' today' : '') + (list.length ? ' has' : '')}>
              {d && <span className="cal-n">{Number(d.slice(8))}</span>}
              {list.slice(0, 3).map((r) => (
                <Link key={r.id} to={`/m/${entity.key}/${r.id}`} className="cal-chip" title={store.titleOf(entity.key, r.id)}>
                  {store.titleOf(entity.key, r.id)}
                </Link>
              ))}
              {list.length > 3 && <span className="muted small">+{list.length - 3} more</span>}
            </div>
          );
        })}
      </div>
      {/* Phones: an agenda list is easier to read than a 7-column grid. */}
      <ul className="cal-agenda">
        {[...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, list]) => list.map((r) => (
          <li key={r.id}>
            <Link to={`/m/${entity.key}/${r.id}`}>
              <span className="muted small" style={{ minWidth: 64 }}>{Number(d.slice(8))} {MONTHS[mo - 1]}</span>
              <span style={{ flex: 1 }}>{store.titleOf(entity.key, r.id)}</span>
              {statusF && <StatusBadge value={String(r[statusF.key] || '')} />}
            </Link>
          </li>
        )))}
        {!count && <li className="muted small" style={{ padding: 8 }}>Nothing this month.</li>}
      </ul>
    </div>
  );
}
