import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../lib/store';
import { ENTITIES, getEntity } from '../../modules/registry';
import { filtersFor } from '../../modules/filters';
import { canRead } from '../../lib/rbac';
import { myAlerts } from '../../lib/alerts';
import { money } from '../../lib/money';
import { formatDate, localDateOf } from '../../lib/format';
import { recordLocation } from '../../lib/geo/locate';
import {
  DEFAULT_SIZE, clampItem, firstItemData, dateFields, groupList, isMoney, itemAllowed, itemRows, itemSeries, measureList, newId, total,
  type Agg, type ChartType, type DashItem, type DashboardDef, type ItemType, type Period, type Range,
} from '../../lib/dashboards';
import { Chart } from '../components/Charts';
import { IndiaMap, type MapPoint } from '../components/IndiaMap';
import { AlertList } from './Alerts';
import { PERIODS, kpiMoney, periodRange } from './Dashboard';
import { useDialogFocus, useFeedback } from '../components/feedback';

const ROW = 96; // px per grid row
const GAP = 14;

const TYPES: { key: ItemType; label: string; hint: string }[] = [
  { key: 'kpi', label: 'KPI tile', hint: 'One number, e.g. invoiced this FY' },
  { key: 'chart', label: 'Chart', hint: 'Bar, line, donut or bars' },
  { key: 'table', label: 'Top list', hint: 'Grouped totals with shares' },
  { key: 'list', label: 'Records', hint: 'Latest records, e.g. new leads' },
  { key: 'map', label: 'India map', hint: 'By state, city and record' },
  { key: 'alerts', label: 'Alerts', hint: 'What needs attention' },
  { key: 'note', label: 'Note', hint: 'A heading or reminder' },
];
const WIDTHS = [{ w: 3, label: 'Small (¼)' }, { w: 4, label: 'Medium (⅓)' }, { w: 6, label: 'Half' }, { w: 8, label: 'Large (⅔)' }, { w: 12, label: 'Full width' }];
const CHARTS: { key: ChartType; label: string }[] = [{ key: 'bar', label: 'Bar' }, { key: 'line', label: 'Line' }, { key: 'donut', label: 'Donut' }, { key: 'hbar', label: 'Bars' }];

const fmtNumber = (it: DashItem, n: number) => (isMoney(it) ? kpiMoney(n) : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + (/kw/i.test(it.measure || '') ? ' kW' : ''));
const fmtFull = (it: DashItem) => (n: number) => (isMoney(it) ? money(n) : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }));

/** The person's own dashboard: view it, or customise it (add, edit, move, resize, remove items). */
export function MyDashboard({ def, onChange, onDelete, editing, setEditing }: {
  def: DashboardDef; onChange: (d: DashboardDef) => void; onDelete: () => void; editing: boolean; setEditing: (e: boolean) => void;
}) {
  const { confirm } = useFeedback();
  const store = useStore();
  const range = periodRange(def.period);
  const [editor, setEditor] = useState<{ item: DashItem; isNew: boolean } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  const setItems = (items: DashItem[]) => onChange({ ...def, items: items.map(clampItem) });
  const update = (id: string, patch: Partial<DashItem>) => setItems(def.items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const move = (id: string, to: number) => {
    const from = def.items.findIndex((x) => x.id === id);
    if (from < 0 || to < 0 || to >= def.items.length) return;
    const next = def.items.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    setItems(next);
  };
  const addNew = () => setEditor({ item: { id: newId(), type: 'chart', title: '', ...firstItemData(store), ...DEFAULT_SIZE.chart }, isNew: true });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="muted small">{formatDate(range.to)}</div>
          {editing
            ? <label className="dash-name">
                <span className="muted small">✎ Dashboard name</span>
                <input className="input dash-title" value={def.title} maxLength={60} placeholder="My dashboard"
                  onChange={(e) => onChange({ ...def, title: e.target.value })}
                  onBlur={(e) => { if (!e.target.value.trim()) onChange({ ...def, title: 'My dashboard' }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              </label>
            : <div className="title-row"><h1>{def.title || 'My dashboard'}</h1><button type="button" className="btn ghost sm rename" aria-label="Rename dashboard" title="Rename" onClick={() => setEditing(true)}>✎</button></div>}
        </div>
        <div className="spacer" />
        <div className="seg" role="group" aria-label="Period">
          {PERIODS.map((p) => <button key={p.key} type="button" className={def.period === p.key ? 'on' : ''} aria-pressed={def.period === p.key} onClick={() => onChange({ ...def, period: p.key as Period })}>{p.label}</button>)}
        </div>
        <button type="button" className="btn" onClick={() => { setEditing(true); addNew(); }}>+ Add item</button>
        {editing ? <>
          <button type="button" className="btn danger" onClick={async () => {
            if (await confirm({ title: 'Delete my dashboard?', body: 'Your items and layout are removed. The default dashboard stays.', okLabel: 'Delete', danger: true })) onDelete();
          }}>Delete dashboard</button>
          <button type="button" className="btn primary" onClick={() => setEditing(false)}>Done</button>
        </> : <button type="button" className="btn" onClick={() => setEditing(true)}>✎ Customize</button>}
      </div>
      {editing && <p className="muted small dash-help">Drag ⠿ to move an item, drag the corner ◢ to resize it (or focus it and use the arrow keys). Changes are saved as you go.</p>}
      {def.items.length === 0 ? (
        <div className="card empty">
          Nothing here yet. <button type="button" className="link-btn" onClick={() => { setEditing(true); addNew(); }}>Add your first item</button>
        </div>
      ) : (
        <div className={'dgrid' + (editing ? ' editing' : '')} ref={grid}>
          {def.items.map((it, i) => (
            <div key={it.id} className={'ditem card' + (dragId === it.id ? ' dragging' : '')} style={{ '--w': it.w, '--h': it.h } as React.CSSProperties}
              onDragOver={(e) => { if (editing && dragId) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== it.id) move(dragId, i); setDragId(null); }}
              aria-label={it.title || TYPES.find((t) => t.key === it.type)?.label}>
              {editing && (
                <div className="ditem-tools">
                  <span className="drag" draggable title="Drag to move" aria-hidden onDragStart={(e) => { setDragId(it.id); e.dataTransfer.setData('text/plain', it.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragId(null)}>⠿</span>
                  <button type="button" className="btn ghost sm" aria-label={`Move ${it.title} earlier`} disabled={i === 0} onClick={() => move(it.id, i - 1)}>←</button>
                  <button type="button" className="btn ghost sm" aria-label={`Move ${it.title} later`} disabled={i === def.items.length - 1} onClick={() => move(it.id, i + 1)}>→</button>
                  <button type="button" className="btn ghost sm" aria-label={`Edit ${it.title}`} onClick={() => setEditor({ item: it, isNew: false })}>✎</button>
                  <button type="button" className="btn ghost sm" aria-label={`Duplicate ${it.title}`} onClick={() => { const next = def.items.slice(); next.splice(i + 1, 0, { ...it, id: newId(), title: `${it.title} (copy)` }); setItems(next); }}>⧉</button>
                  <button type="button" className="btn ghost sm" aria-label={`Remove ${it.title}`} onClick={() => setItems(def.items.filter((x) => x.id !== it.id))}>✕</button>
                </div>
              )}
              <ItemView item={it} range={range} height={it.h * ROW + (it.h - 1) * GAP} />
              {editing && <Resizer item={it} grid={grid} onResize={(w, h) => update(it.id, { w, h })} />}
            </div>
          ))}
        </div>
      )}
      {editor && (
        <ItemEditor initial={editor.item} isNew={editor.isNew} range={range} onCancel={() => setEditor(null)}
          onSave={(item) => {
            setItems(editor.isNew ? [...def.items, item] : def.items.map((x) => (x.id === item.id ? item : x)));
            setEditor(null);
          }} />
      )}
    </>
  );
}

/** Corner handle: drag to resize on the 12-column grid; with focus, arrow keys change width and height. */
function Resizer({ item, grid, onResize }: { item: DashItem; grid: React.RefObject<HTMLDivElement>; onResize: (w: number, h: number) => void }) {
  const start = useRef<{ x: number; y: number; w: number; h: number; col: number } | null>(null);
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);
  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    const g = grid.current;
    if (!g) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const col = (g.clientWidth - GAP * 11) / 12;
    start.current = { x: e.clientX, y: e.clientY, w: item.w, h: item.h, col };
  };
  const moveP = (e: RPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s) return;
    const w = Math.min(12, Math.max(2, Math.round(s.w + (e.clientX - s.x) / (s.col + GAP))));
    const h = Math.min(6, Math.max(1, Math.round(s.h + (e.clientY - s.y) / (ROW + GAP))));
    setLive({ w, h });
  };
  const up = () => {
    if (start.current && live) onResize(live.w, live.h);
    start.current = null;
    setLive(null);
  };
  const key = (e: RKeyboardEvent) => {
    const d = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    onResize(Math.min(12, Math.max(2, item.w + d[0])), Math.min(6, Math.max(1, item.h + d[1])));
  };
  return (
    <>
      {live && <div className="resize-ghost" aria-hidden>{live.w} × {live.h}</div>}
      <button type="button" className="resizer" aria-label={`Resize ${item.title}: ${item.w} of 12 columns wide, ${item.h} rows tall. Use arrow keys.`}
        onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>◢</button>
    </>
  );
}

/** One dashboard item, drawn from live data. Also used as the preview in the editor. */
export function ItemView({ item: it, range, height, full, noExpand }: { item: DashItem; range: Range; height: number; full?: boolean; noExpand?: boolean }) {
  const store = useStore();
  const nav = useNavigate();
  const [big, setBig] = useState(false);
  // Open any chart, list or map large, with all its data (⤢); not needed for a single number or a note.
  const expand = !full && !noExpand && it.type !== 'kpi' && it.type !== 'note'
    ? <button type="button" className="btn ghost sm ditem-expand" aria-label={`Open ${it.title || 'item'} large`} title="Open large" onClick={() => setBig(true)}>⤢</button> : null;
  const bigView = big ? <ExpandedItem item={it} range={range} onClose={() => setBig(false)} /> : null;
  const e = it.entity ? getEntity(it.entity) : undefined;
  const r = it.dateField ? range : null;
  const rows = useMemo(() => (e && itemAllowed(store, it) ? itemRows(store, it, r) : []), [store, store.getVersion(), it, r?.from, r?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = it.color ? `var(--c${it.color})` : undefined;

  if (!itemAllowed(store, it)) return <div className="ditem-body"><h2>{it.title}</h2><p className="muted">Your access rights do not include this data.</p></div>;
  const listUrl = e ? `/m/${e.key}${it.filters?.length ? `?f=${encodeURIComponent(it.filters.join(','))}` : ''}` : '/';

  if (it.type === 'note') return (
    <div className="ditem-body note" style={color ? { borderLeftColor: color } : undefined}>
      {it.title && <h2>{it.title}</h2>}
      <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{it.text}</p>
    </div>
  );
  if (it.type === 'alerts') {
    const alerts = myAlerts(store, (m) => canRead(store.user, m), (e) => getEntity(e)?.module || '');
    return <div className="ditem-body">{expand}{bigView}<h2>{it.title || 'Needs attention'} ({alerts.length})</h2><div className="ditem-scroll"><AlertList alerts={alerts} limit={full ? 200 : Math.max(2, it.h * 2)} /></div></div>;
  }
  if (!e) return <div className="ditem-body"><p className="muted">Choose what data this item shows.</p></div>;

  if (it.type === 'kpi') {
    const now = total(store, it, rows);
    const before = it.compare && r ? total(store, it, itemRows(store, it, r, true)) : null;
    const pct = before && before > 0 ? Math.round(((now - before) / before) * 100) : null;
    return (
      <Link to={listUrl} className="ditem-body kpi-tile" style={color ? { borderLeftColor: color } : undefined}>
        <div className="label">{it.title}</div>
        <div className="value" title={fmtFull(it)(now)}>{fmtNumber(it, now)}</div>
        <div className="sub">
          {before !== null && (pct === null ? (now > 0 ? <span className="trend up">▲ new</span> : null)
            : <span className={'trend ' + (pct > 0 ? 'up' : pct < 0 ? 'down' : '')}>{pct > 0 ? '▲' : pct < 0 ? '▼' : '●'} {Math.abs(pct)}% vs previous</span>)}
          {it.target ? <>
            <div className="kpi-target" role="progressbar" aria-label={`${it.title}: ${Math.round((now / it.target) * 100)}% of target`} aria-valuenow={Math.round((now / it.target) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${Math.min(100, (now / it.target) * 100)}%`, background: color }} />
            </div>
            <span className="muted small">{Math.round((now / it.target) * 100)}% of {fmtNumber(it, it.target)}</span>
          </> : null}
        </div>
      </Link>
    );
  }
  if (it.type === 'chart') {
    const data = itemSeries(store, it, rows);
    const kind = it.chart || 'bar';
    // Many bars or points: the chart keeps a readable width and scrolls sideways; long bar lists scroll down.
    const minW = kind === 'bar' || kind === 'line' ? data.labels.length * (data.series.length > 1 ? 56 : 40) : 0;
    const h = kind === 'hbar' ? Math.max(height - 56, data.labels.length * 26 + 20) : Math.max(120, height - 56);
    return (
      <div className="ditem-body">
        {expand}{bigView}
        <h2><Link to={listUrl}>{it.title}</Link></h2>
        {data.labels.length ? (
          <div className="ditem-scroll both" tabIndex={0} role="region" aria-label={`${it.title || 'Chart'} chart`}><div style={{ minWidth: minW || undefined }}>
            <Chart data={data} kind={kind} format={fmtFull(it)} height={h} />
          </div></div>
        ) : <p className="muted">No records for this period and these filters.</p>}
        {full && data.labels.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}><table className="table">
            <thead><tr><th>{groupList(getEntity(it.entity!)!).find((g) => g.key === it.groupBy)?.label || 'Group'}</th>{data.series.map((sr) => <th key={sr.name} className="num">{sr.name}</th>)}</tr></thead>
            <tbody>{data.labels.map((l, i) => <tr key={l + i}><td>{l}</td>{data.series.map((sr) => <td key={sr.name} className="num">{fmtFull(it)(sr.values[i])}</td>)}</tr>)}</tbody>
          </table></div>
        )}
      </div>
    );
  }
  if (it.type === 'table') {
    const data = itemSeries(store, it, rows);
    const vals = data.series[0]?.values || [];
    const sum = vals.reduce((s, v) => s + v, 0);
    const top = Math.max(0, ...vals);
    return (
      <div className="ditem-body">
        {expand}{bigView}
        <h2><Link to={listUrl}>{it.title}</Link></h2>
        <div className="ditem-scroll">
          {data.labels.length ? (
            <table className="share-table"><tbody>
              {data.labels.map((l, i) => (
                <tr key={l + i}><td>{l}</td><td className="share" title={sum ? `${Math.round((vals[i] / sum) * 100)}% of the total` : undefined}><i style={{ width: `${top ? (vals[i] / top) * 100 : 0}%`, background: color }} /></td><td className="num">{fmtFull(it)(vals[i])}</td></tr>
              ))}
            </tbody></table>
          ) : <p className="muted">No records for this period and these filters.</p>}
        </div>
      </div>
    );
  }
  if (it.type === 'list') {
    const by = it.dateField || 'createdAt';
    const sorted = [...rows].sort((a, b) => String(b[by] || '').localeCompare(String(a[by] || ''))).slice(0, full ? 100 : it.limit || 6);
    const showValue = it.measure && it.measure !== '__count';
    return (
      <div className="ditem-body">
        {expand}{bigView}
        <h2><Link to={listUrl}>{it.title}</Link></h2>
        <div className="ditem-scroll">
          {sorted.length ? (
            <ul className="alert-list">
              {sorted.map((rec) => (
                <li key={rec.id}><a href={`#/m/${e.key}/${rec.id}`} onClick={(ev) => { ev.preventDefault(); nav(`/m/${e.key}/${rec.id}`); }}>
                  <span className="muted small" style={{ minWidth: 90 }}>{rec[by] ? formatDate(String(rec[by]).length > 10 ? localDateOf(String(rec[by])) : String(rec[by])) : ''}</span>
                  <span style={{ flex: 1 }}>{rec.number ? `${rec.number} · ` : ''}{store.titleOf(e.key, rec.id)}</span>
                  {showValue && <span className="num">{fmtFull(it)(total(store, { ...it, agg: 'sum' }, [rec]))}</span>}
                </a></li>
              ))}
            </ul>
          ) : <p className="muted">Nothing to show.</p>}
        </div>
      </div>
    );
  }
  // map
  const points: MapPoint[] = [];
  const byState: Record<string, number> = {};
  for (const rec of rows) {
    const loc = recordLocation(store, e.key, rec);
    if (!loc) continue;
    if (loc.state) byState[loc.state] = (byState[loc.state] || 0) + (it.agg === 'count' || !it.measure || it.measure === '__count' ? 1 : total(store, { ...it, agg: 'sum' }, [rec]));
    points.push({ lat: loc.lat, lng: loc.lng, state: loc.state, city: loc.city, label: store.titleOf(e.key, rec.id), to: `/m/${e.key}/${rec.id}` });
  }
  return (
    <div className="ditem-body">
      {expand}{bigView}
      <h2>{it.title}</h2>
      <IndiaMap stateValues={byState} points={points} format={fmtFull(it)} valueLabel={it.agg === 'count' || it.measure === '__count' ? e.plural : (measureList(e).find((m) => m.key === it.measure)?.label || e.plural)}
        pointLabel={e.plural} height={Math.max(200, height - 120)} />
    </div>
  );
}

/** Add or change an item, with a live preview of exactly what it will show. */
export function ItemEditor({ initial, isNew, range, onSave, onCancel }: { initial: DashItem; isNew: boolean; range: Range; onSave: (it: DashItem) => void; onCancel: () => void }) {
  const store = useStore();
  const [it, setIt] = useState<DashItem>(initial);
  const dlg = useDialogFocus(true, onCancel);
  const set = (p: Partial<DashItem>) => setIt((x) => ({ ...x, ...p }));
  const entities = ENTITIES.filter((x) => canRead(store.user, x.module));
  const e = it.entity ? getEntity(it.entity) : undefined;
  const needsData = !['alerts', 'note'].includes(it.type);
  const measures = e ? measureList(e) : [];
  const groups = e ? groupList(e) : [];
  const filters = e ? filtersFor(e) : [];
  const sections = [...new Set(filters.map((f) => f.section))];
  const dates = e ? dateFields(e) : [];
  // Changing the data source resets what belongs to the old one.
  useEffect(() => {
    if (!e) return;
    if (!measures.some((m) => m.key === it.measure)) set({ measure: '__count', agg: 'count' });
    if (!groups.some((g) => g.key === it.groupBy)) set({ groupBy: groups.find((g) => g.key === e.statusField)?.key || groups[0]?.key });
    if (it.split && !groups.some((g) => g.key === it.split)) set({ split: undefined });
    if (it.dateField && !dates.some((d) => d.key === it.dateField)) set({ dateField: undefined });
    set({ filters: (it.filters || []).filter((k) => filters.some((f) => f.key === k)) });
  }, [it.entity]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = it.title.trim() || autoTitle(it);
  const preview = { ...it, title };

  return (
    <div className="modal-back">
      <div ref={dlg} className="modal modal-form item-editor" role="dialog" aria-modal="true" aria-label={isNew ? 'Add dashboard item' : 'Edit dashboard item'}>
        <h2>{isNew ? 'Add an item' : 'Edit item'}</h2>
        <div className="ie-grid">
          <div className="ie-form">
            <div className="type-pick" role="radiogroup" aria-label="Item type">
              {TYPES.map((t) => (
                <button key={t.key} type="button" role="radio" aria-checked={it.type === t.key} className={it.type === t.key ? 'on' : ''}
                  onClick={() => set({ type: t.key, ...(isNew ? DEFAULT_SIZE[t.key] : {}), ...(t.key === 'kpi' && !it.compare ? { compare: true } : {}) })}>
                  <strong>{t.label}</strong><span className="muted small">{t.hint}</span>
                </button>
              ))}
            </div>
            <label className="field"><span>Title</span><input className="input" value={it.title} placeholder={autoTitle(it)} maxLength={80} onChange={(x) => set({ title: x.target.value })} /></label>
            {it.type === 'note' && <label className="field"><span>Text</span><textarea className="input" rows={3} value={it.text || ''} onChange={(x) => set({ text: x.target.value })} /></label>}
            {needsData && <>
              <label className="field"><span>Data from</span>
                <select className="input" value={it.entity || ''} onChange={(x) => set({ entity: x.target.value })}>
                  {entities.map((x) => <option key={x.key} value={x.key}>{x.plural}</option>)}
                </select>
              </label>
              <div className="ie-row">
                <label className="field"><span>{it.type === 'map' ? 'Shade states by' : it.type === 'list' ? 'Value column' : 'Measure'}</span>
                  <select className="input" value={it.agg === 'count' ? '__count' : it.measure || '__count'} onChange={(x) => set(x.target.value === '__count' ? { measure: '__count', agg: 'count' } : { measure: x.target.value, agg: it.agg === 'count' || !it.agg ? 'sum' : it.agg })}>
                    {measures.map((m) => <option key={m.key} value={m.key}>{m.key === '__count' ? 'Count of records' : m.label}</option>)}
                  </select>
                </label>
                {it.agg !== 'count' && it.measure !== '__count' && ['kpi', 'chart', 'table'].includes(it.type) && (
                  <label className="field"><span>As</span>
                    <select className="input" value={it.agg || 'sum'} onChange={(x) => set({ agg: x.target.value as Agg })}>
                      <option value="sum">Total (sum)</option><option value="avg">Average</option>
                    </select>
                  </label>
                )}
              </div>
              {(it.type === 'chart' || it.type === 'table') && (
                <div className="ie-row">
                  <label className="field"><span>Group by</span>
                    <select className="input" value={it.groupBy || ''} onChange={(x) => set({ groupBy: x.target.value })}>
                      {groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                    </select>
                  </label>
                  {it.type === 'chart' && (
                    <label className="field"><span>Split by</span>
                      <select className="input" value={it.split || ''} onChange={(x) => set({ split: x.target.value || undefined, chart: x.target.value && (it.chart === 'donut' || it.chart === 'hbar') ? 'bar' : it.chart })}>
                        <option value="">— none —</option>
                        {groups.filter((g) => g.key !== it.groupBy).map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}
              {it.type === 'chart' && (
                <div className="seg" role="group" aria-label="Chart type">
                  {CHARTS.filter((c) => !it.split || c.key === 'bar' || c.key === 'line').map((c) => (
                    <button key={c.key} type="button" className={(it.chart || 'bar') === c.key ? 'on' : ''} aria-pressed={(it.chart || 'bar') === c.key} onClick={() => set({ chart: c.key })}>{c.label}</button>
                  ))}
                </div>
              )}
              <div className="ie-row">
                <label className="field"><span>Period</span>
                  <select className="input" value={it.dateField || ''} onChange={(x) => set({ dateField: x.target.value || undefined })}>
                    <option value="">All time</option>
                    {dates.map((d) => <option key={d.key} value={d.key}>Dashboard period, on {d.label.toLowerCase()}</option>)}
                  </select>
                </label>
                {['chart', 'table', 'list'].includes(it.type) && (
                  <label className="field"><span>{it.type === 'list' ? 'Show' : 'Top'}</span>
                    <input className="input" type="number" min={1} max={50} value={it.limit || ''} placeholder={it.type === 'list' ? '6' : 'auto'}
                      onChange={(x) => set({ limit: x.target.value ? Math.max(1, Math.min(50, Number(x.target.value))) : undefined })} />
                  </label>
                )}
              </div>
              {it.type === 'kpi' && (
                <div className="ie-row">
                  <label className="field"><span>Target (optional)</span>
                    <input className="input" type="number" min={0} value={it.target ?? ''} onChange={(x) => set({ target: x.target.value ? Number(x.target.value) : undefined })} />
                  </label>
                  <label className="check"><input type="checkbox" checked={!!it.compare} disabled={!it.dateField} onChange={(x) => set({ compare: x.target.checked })} /> Compare with the period before</label>
                </div>
              )}
              {filters.length > 0 && (
                <fieldset className="ie-filters">
                  <legend>Filters {it.filters?.length ? <span className="badge info">{it.filters.length}</span> : null}</legend>
                  {sections.map((sec) => (
                    <div key={sec} role="group" aria-label={sec}>
                      <div className="sp-title">{sec}</div>
                      {filters.filter((f) => f.section === sec).map((f) => (
                        <label key={f.key} className="check small">
                          <input type="checkbox" checked={!!it.filters?.includes(f.key)}
                            onChange={(x) => set({ filters: x.target.checked ? [...(it.filters || []), f.key] : (it.filters || []).filter((k) => k !== f.key) })} /> {f.label}
                        </label>
                      ))}
                    </div>
                  ))}
                </fieldset>
              )}
            </>}
            <div className="ie-row">
              <label className="field"><span>Width</span>
                <select className="input" value={it.w} onChange={(x) => set({ w: Number(x.target.value) })}>
                  {WIDTHS.map((w) => <option key={w.w} value={w.w}>{w.label}</option>)}
                  {!WIDTHS.some((w) => w.w === it.w) && <option value={it.w}>{it.w} of 12 columns</option>}
                </select>
              </label>
              <label className="field"><span>Height</span>
                <select className="input" value={it.h} onChange={(x) => set({ h: Number(x.target.value) })}>
                  {[1, 2, 3, 4, 5, 6].map((h) => <option key={h} value={h}>{h} {h === 1 ? 'row' : 'rows'}</option>)}
                </select>
              </label>
            </div>
            {['kpi', 'note', 'table'].includes(it.type) && (
              <div className="swatches" role="radiogroup" aria-label="Colour">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={it.color === c} aria-label={`Colour ${c}`} className={it.color === c ? 'on' : ''}
                    style={{ background: `var(--c${c})` }} onClick={() => set({ color: c })} />
                ))}
              </div>
            )}
          </div>
          <div className="ie-preview" aria-label="Preview">
            <div className="sp-title">Preview</div>
            <div className="ditem card preview" style={{ '--w': 12, '--h': it.h } as React.CSSProperties}>
              <ItemView item={preview} range={range} height={it.h * ROW + (it.h - 1) * GAP} noExpand />
            </div>
          </div>
        </div>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => onSave(clampItem({ ...it, title }))}>{isNew ? 'Add to dashboard' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function autoTitle(it: DashItem): string {
  const e = it.entity ? getEntity(it.entity) : undefined;
  if (it.type === 'alerts') return 'Needs attention';
  if (it.type === 'note') return 'Note';
  if (!e) return 'New item';
  const m = measureList(e).find((x) => x.key === it.measure);
  const what = it.agg === 'count' || !m || m.key === '__count' ? e.plural : `${it.agg === 'avg' ? 'Average' : ''} ${m.label}`.trim();
  if (it.type === 'chart' || it.type === 'table') {
    const g = groupList(e).find((x) => x.key === it.groupBy);
    return g ? `${what} by ${g.label.replace(/ \((month|quarter|financial year)\)$/, '').toLowerCase()}` : what;
  }
  if (it.type === 'list') return `Latest ${e.plural.toLowerCase()}`;
  if (it.type === 'map') return `${e.plural} across India`;
  return what;
}

/** One dashboard item, large, with all its data. */
function ExpandedItem({ item, range, onClose }: { item: DashItem; range: Range; onClose: () => void }) {
  const dlg = useDialogFocus(true, onClose);
  const h = Math.round(Math.min(640, Math.max(320, window.innerHeight * 0.6)));
  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dlg} className="modal ditem-big" role="dialog" aria-modal="true" aria-label={item.title || 'Dashboard item'}>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn sm" onClick={onClose}>Close</button></div>
        <ItemView item={item} range={range} height={h} full />
      </div>
    </div>
  );
}
