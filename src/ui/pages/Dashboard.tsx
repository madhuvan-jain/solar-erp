import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../lib/store';
import { myAlerts } from '../../lib/alerts';
import { pushPref } from '../../lib/prefs';
import { canRead } from '../../lib/rbac';
import { lineAmount, money, round2 } from '../../lib/money';
import { addDaysIso, formatDate, localDateOf, todayIso } from '../../lib/format';
import { canonicalState } from '../../lib/states';
import type { LineItem, Rec } from '../../lib/schema';
import { getEntity } from '../../modules/registry';
import { AlertList } from './Alerts';
import { ChartCard, type ChartData } from '../components/Charts';
import { IndiaMap, type MapPoint } from '../components/IndiaMap';
import { monthLabel } from '../components/Views';
import { recordLocation } from '../../lib/geo/locate';
import { DEFAULT_SIZE, clampItem, firstItemData, newId, type DashItem } from '../../lib/dashboards';
import { ItemEditor, ItemView } from './MyDashboard';

export type Period = 'month' | 'quarter' | 'fy' | 'year' | 'all';
export const PERIODS: { key: Period; label: string }[] = [
  { key: 'month', label: 'This month' }, { key: 'quarter', label: 'Last 3 months' }, { key: 'fy', label: 'This FY' },
  { key: 'year', label: 'Last 12 months' }, { key: 'all', label: 'All time' },
];

/** Inclusive date range for a period, plus the same-length range just before it (for the trend arrow). */
export function periodRange(p: Period, today = todayIso()): { from: string; to: string; prevFrom: string; prevTo: string } {
  const [y, m] = today.split('-').map(Number);
  let from: string;
  if (p === 'month') from = `${today.slice(0, 7)}-01`;
  else if (p === 'quarter') from = addMonthsIso(`${today.slice(0, 7)}-01`, -2);
  else if (p === 'year') from = addMonthsIso(`${today.slice(0, 7)}-01`, -11);
  else if (p === 'fy') from = `${m >= 4 ? y : y - 1}-04-01`;
  else from = '1900-01-01';
  const days = Math.round((Date.parse(today) - Date.parse(from)) / 86400000);
  const prevTo = addDaysIso(from, -1);
  // The same stretch of the period before: 1–12 Nov against 1–12 Oct, FY-to-date against last FY to the same day.
  if (p === 'month' || p === 'fy') {
    const prevFrom = addMonthsIso(from, p === 'month' ? -1 : -12);
    const end = addDaysIso(prevFrom, days);
    return { from, to: today, prevFrom, prevTo: end < prevTo ? end : prevTo };
  }
  const prevFrom = p === 'all' ? '1900-01-01' : addDaysIso(prevTo, -days);
  return { from, to: today, prevFrom, prevTo };
}

function addMonthsIso(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** Month keys (YYYY-MM) from `from` to `to`, at most the last 24. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = (from < '2000-01-01' ? addMonthsIso(`${to.slice(0, 7)}-01`, -11) : from).slice(0, 7);
  while (cur <= to.slice(0, 7) && out.length < 240) { out.push(cur); cur = addMonthsIso(`${cur}-01`, 1).slice(0, 7); }
  return out.slice(-24);
}

/** "3 kW" → 3; unknown sizes last. */
const sizeNum = (k: string) => (k === 'Size not set' ? Infinity : parseFloat(k));
/** How many systems of each size, e.g. 3 kW × 4, 5 kW × 2. */
function sizeCounts(kws: unknown[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of kws) {
    const n = Number(v);
    const k = Number.isFinite(n) && n > 0 ? `${round2(n)} kW` : 'Size not set';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return new Map([...m].sort((a, b) => sizeNum(a[0]) - sizeNum(b[0])));
}
function SizeChips({ sizes, total }: { sizes: Map<string, number>; total: number }) {
  if (!sizes.size) return <>no systems yet</>;
  const list = [...sizes];
  return (
    <span className="size-chips" title={`${total} kW in total`}>
      {list.slice(0, 4).map(([k, n]) => <span key={k} className="size-chip">{k} × {n}</span>)}
      {list.length > 4 && <span className="size-chip more">+{list.length - 4} sizes</span>}
      <span className="muted small"> · {total} kW total</span>
    </span>
  );
}

/** Whole rupees for KPI tiles; lakh/crore above ₹10 lakh so big numbers fit on a phone. Full value in the tooltip. */
export function kpiMoney(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e6) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
}

function Trend({ now, before }: { now: number; before: number }) {
  if (!(before > 0) && !(now > 0)) return null;
  if (!(before > 0)) return <span className="trend up">▲ new</span>;
  if (now / before >= 3) return <span className="trend up">▲ {Math.round(now / before)}× previous</span>;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <span className="trend">● same as before</span>;
  return <span className={'trend ' + (pct > 0 ? 'up' : 'down')}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% vs previous</span>;
}

export function Dashboard() {
  const store = useStore();
  const today = todayIso();
  const [period, setPeriod] = useState<Period>('fy');
  const [mapMetric, setMapMetric] = useState<'sales' | 'customers'>('sales');
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<DashLayout>(() => loadLayout(store.user?.id || ''));
  // The order saved on another device arrives a moment after sign-in (cloud mode).
  useEffect(() => {
    const h = () => setLayout(loadLayout(store.user?.id || ''));
    window.addEventListener('ss1-defdash', h);
    return () => window.removeEventListener('ss1-defdash', h);
  }, [store.user?.id]);
  const save = (l: DashLayout) => { setLayout(l); saveLayout(store.user?.id || '', l); };
  const [editor, setEditor] = useState<{ item: DashItem; isNew: boolean } | null>(null);
  const extra = layout.items || [];
  // "+ Add item" opens Customize for the new item; cancelling puts it back as it was.
  const editingBefore = useRef(false);
  const addItem = () => { editingBefore.current = editing; setEditing(true); setEditor({ item: { id: newId(), type: 'chart', title: '', ...firstItemData(store), ...DEFAULT_SIZE.chart, w: 6 }, isNew: true }); };
  const r = periodRange(period, today);
  const inR = (d: unknown) => { const x = String(d || '').slice(0, 10); return x >= r.from && x <= r.to; };
  const inPrev = (d: unknown) => { const x = String(d || '').slice(0, 10); return x >= r.prevFrom && x <= r.prevTo; };
  const fin = canRead(store.user, 'finance'), crm = canRead(store.user, 'crm');
  const alerts = myAlerts(store, (m) => canRead(store.user, m), (e) => getEntity(e)?.module || '', today);

  const d = useMemo(() => {
    const issued = store.all('invoices').filter((i) => i.status !== 'Cancelled' && i.status !== 'Draft');
    const sum = (list: Rec[], f: (x: Rec) => number) => round2(list.reduce((a, x) => a + f(x), 0));
    const total = (i: Rec) => store.computed('invoices', i).grandTotal;
    const invoiced = sum(issued.filter((i) => inR(i.date)), total);
    const invoicedPrev = sum(issued.filter((i) => inPrev(i.date)), total);
    const pays = store.all('payments');
    const collected = sum(pays.filter((p) => inR(p.date)), (p) => Number(p.amount) || 0);
    const collectedPrev = sum(pays.filter((p) => inPrev(p.date)), (p) => Number(p.amount) || 0);
    const receivable = sum(issued, (i) => Math.max(0, store.computed('invoices', i).balance));
    const overdue = sum(issued.filter((i) => i.dueDate && String(i.dueDate) < today), (i) => Math.max(0, store.computed('invoices', i).balance));
    const openQuotes = store.all('quotations').filter((q) => ['Draft', 'Sent'].includes(String(q.status)));
    const pipeline = sum(openQuotes, (q) => store.computed('quotations', q).grandTotal);
    const leads = store.all('leads');
    const newLeads = leads.filter((l) => inR(localDateOf(l.createdAt))).length;
    const newLeadsPrev = leads.filter((l) => inPrev(localDateOf(l.createdAt))).length;
    const won = leads.filter((l) => l.status === 'Won').length, lost = leads.filter((l) => l.status === 'Lost').length;
    const projects = store.all('projects');
    const active = projects.filter((p) => !['Handover', 'On Hold'].includes(String(p.stage)));
    const doneInst = store.all('installations').filter((i) => i.status === 'Completed' && inR(i.scheduledDate));
    const kwInstalled = round2(doneInst.reduce((a, i) => a + (Number(store.get('projects', i.projectId)?.capacityKw) || 0), 0));
    // Systems counted by size (3 kW, 5 kW, 10 kW…), not just one kW total.
    const instSizes = sizeCounts(doneInst.map((i) => store.get('projects', i.projectId)?.capacityKw));
    const activeSizes = sizeCounts(active.map((p) => p.capacityKw));
    const sizeKeys = [...new Set([...instSizes.keys(), ...activeSizes.keys()])].sort((a, b) => sizeNum(a) - sizeNum(b));
    const bySize: ChartData = { labels: sizeKeys, series: [
      { name: 'Installed', values: sizeKeys.map((k) => instSizes.get(k) || 0) },
      { name: 'In progress', values: sizeKeys.map((k) => activeSizes.get(k) || 0) },
    ] };
    const openTickets = store.all('tickets').filter((t) => !['Resolved', 'Closed'].includes(String(t.status))).length;

    const months = monthsBetween(r.from, r.to);
    const mIdx = new Map(months.map((m, i) => [m, i]));
    const inv = months.map(() => 0), col = months.map(() => 0), exp = months.map(() => 0), sup = months.map(() => 0);
    for (const i of issued) { const k = mIdx.get(String(i.date).slice(0, 7)); if (k !== undefined) inv[k] += total(i); }
    for (const p of pays) { const k = mIdx.get(String(p.date).slice(0, 7)); if (k !== undefined) col[k] += Number(p.amount) || 0; }
    for (const e of store.all('expenses')) { const k = mIdx.get(String(e.date).slice(0, 7)); if (k !== undefined) exp[k] += Number(e.amount) || 0; }
    for (const p of store.all('supplierPayments')) { const k = mIdx.get(String(p.date).slice(0, 7)); if (k !== undefined) sup[k] += Number(p.amount) || 0; }
    const trend: ChartData = { labels: months.map(monthLabel), series: [
      { name: 'Invoiced', values: inv.map(round2) }, { name: 'Collected', values: col.map(round2) }, { name: 'Expenses', values: exp.map(round2) },
      ...(sup.some((v) => v > 0) ? [{ name: 'Paid to suppliers', values: sup.map(round2) }] : []),
    ] };

    // Sales by product category, from the taxable value of each invoice line.
    const cat = new Map<string, number>();
    for (const i of issued.filter((x) => inR(x.date))) {
      const t = store.totalsFor('invoices', i);
      const ratio = t.subtotal > 0 ? t.taxable / t.subtotal : 1;
      for (const it of (i.items as LineItem[]) || []) {
        if (!it) continue;
        const c = String(store.get('products', it.productId)?.category || 'Other');
        cat.set(c, (cat.get(c) || 0) + lineAmount(it) * ratio);
      }
    }
    const byCat = [...cat].sort((a, b) => b[1] - a[1]);
    const catData: ChartData = { labels: byCat.map(([k]) => k), series: [{ name: 'Sales (taxable)', values: byCat.map(([, v]) => round2(v)) }] };

    const stages = getEntity('leads')!.fields.find((f) => f.key === 'status')!.options!;
    const funnel: ChartData = { labels: stages, series: [{ name: 'Leads', values: stages.map((s) => leads.filter((l) => l.status === s).length) }] };
    const src = new Map<string, number>();
    for (const l of leads.filter((x) => inR(localDateOf(x.createdAt)))) src.set(String(l.source || 'Other'), (src.get(String(l.source || 'Other')) || 0) + 1);
    const srcSorted = [...src].sort((a, b) => b[1] - a[1]);
    const sources: ChartData = { labels: srcSorted.map(([k]) => k), series: [{ name: 'Leads', values: srcSorted.map(([, v]) => v) }] };
    const pstages = getEntity('projects')!.fields.find((f) => f.key === 'stage')!.options!;
    const projStages: ChartData = { labels: pstages, series: [{ name: 'Projects', values: pstages.map((s) => projects.filter((p) => p.stage === s).length) }] };

    const cust = new Map<string, number>();
    for (const i of issued.filter((x) => inR(x.date))) cust.set(String(i.customerId), (cust.get(String(i.customerId)) || 0) + total(i));
    const topCust = [...cust].sort((a, b) => b[1] - a[1]).slice(0, 7);
    const topCustomers: ChartData = { labels: topCust.map(([id]) => store.titleOf('customers', id)), series: [{ name: 'Invoiced', values: topCust.map(([, v]) => round2(v)) }] };

    // Map: sales by state from invoices (place of supply), customers as dots.
    const salesByState: Record<string, number> = {};
    for (const i of issued.filter((x) => inR(x.date))) {
      const loc = recordLocation(store, 'invoices', i);
      const st = canonicalState(i.placeOfSupply) || loc?.state;
      if (st) salesByState[st] = round2((salesByState[st] || 0) + total(i));
    }
    const custByState: Record<string, number> = {};
    const points: MapPoint[] = [];
    for (const c of store.all('customers')) {
      const loc = recordLocation(store, 'customers', c);
      if (!loc) continue;
      if (loc.state) custByState[loc.state] = (custByState[loc.state] || 0) + 1;
      points.push({ lat: loc.lat, lng: loc.lng, state: loc.state, city: loc.city, label: String(c.name), to: `/m/customers/${c.id}` });
    }

    return {
      invoiced, invoicedPrev, collected, collectedPrev, receivable, overdue, pipeline, openQuotes: openQuotes.length,
      newLeads, newLeadsPrev, conversion: won + lost ? Math.round((won / (won + lost)) * 100) : null, won, closed: won + lost,
      active: active.length, activeKw: round2(active.reduce((a, p) => a + (Number(p.capacityKw) || 0), 0)), kwInstalled, installs: doneInst.length, openTickets, instSizes, activeSizes, bySize,
      trend, catData, funnel, sources, projStages, topCustomers, salesByState, custByState, points,
    };
  }, [store, store.getVersion(), period, today]);

  const followUps = store.all('leads')
    .filter((l) => l.nextFollowUp && !['Won', 'Lost'].includes(String(l.status)) && String(l.nextFollowUp).slice(0, 10) >= today)
    .sort((a, b) => String(a.nextFollowUp).localeCompare(String(b.nextFollowUp))).slice(0, 6);
  const upcoming = store.all('installations').filter((i) => ['Scheduled', 'In Progress'].includes(String(i.status)))
    .sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate))).slice(0, 6);
  const periodName = PERIODS.find((p) => p.key === period)!.label.replace(/^This|^Last|^All/, (w) => w.toLowerCase());

  const kpis = [
    { label: 'Invoiced', value: kpiMoney(d.invoiced), full: money(d.invoiced), sub: <Trend now={d.invoiced} before={d.invoicedPrev} />, to: '/m/invoices', mod: 'finance' },
    { label: 'Collected', value: kpiMoney(d.collected), full: money(d.collected), sub: <Trend now={d.collected} before={d.collectedPrev} />, to: '/m/payments', mod: 'finance' },
    { label: 'Receivables', value: kpiMoney(d.receivable), full: money(d.receivable), sub: d.overdue > 0 ? <span className="trend down">⚠ {kpiMoney(d.overdue)} overdue</span> : 'nothing overdue', to: '/m/invoices', mod: 'finance' },
    { label: 'Open quotations', value: kpiMoney(d.pipeline), full: money(d.pipeline), sub: `${d.openQuotes} draft or sent`, to: '/m/quotations', mod: 'sales' },
    { label: 'New leads', value: String(d.newLeads), sub: <Trend now={d.newLeads} before={d.newLeadsPrev} />, to: '/m/leads', mod: 'crm' },
    { label: 'Conversion rate', value: d.conversion === null ? '—' : `${d.conversion}%`, sub: `${d.won} won of ${d.closed} closed`, to: '/m/leads?status=Won', mod: 'crm' },
    { label: 'Installed', value: `${d.installs} system${d.installs === 1 ? '' : 's'}`, full: `${d.kwInstalled} kW in total`,
      sub: <SizeChips sizes={d.instSizes} total={d.kwInstalled} />, to: '/m/installations?f=status%3ACompleted', mod: 'installation' },
    { label: 'Active projects', value: String(d.active), full: `${d.activeKw} kW in progress`,
      sub: <SizeChips sizes={d.activeSizes} total={d.activeKw} />, to: '/m/projects', mod: 'projects' },
    { label: 'Open tickets', value: String(d.openTickets), sub: 'service & complaints', to: '/m/tickets', mod: 'service' },
  ].filter((k) => canRead(store.user, k.mod));

  const mapValues = mapMetric === 'sales' && fin ? d.salesByState : d.custByState;

  // Every tile and section has a key, so the person can put them in their own order and hide some (✎ Customize).
  const blocks: { key: string; label: string; wide?: boolean; el: JSX.Element }[] = [];
  if (crm || fin) blocks.push({ key: 'map', label: 'India map and alerts', wide: true, el: (
    <div className="grid map-layout">
      <div className="card">
        <div className="chart-head">
          <h2>{mapMetric === 'sales' && fin ? `Sales by state · ${periodName}` : 'Customers across India'}</h2>
          {fin && crm && (
            <div className="seg" role="group" aria-label="Map shows">
              <button type="button" className={mapMetric === 'sales' ? 'on' : ''} aria-pressed={mapMetric === 'sales'} onClick={() => setMapMetric('sales')}>Sales ₹</button>
              <button type="button" className={mapMetric === 'customers' ? 'on' : ''} aria-pressed={mapMetric === 'customers'} onClick={() => setMapMetric('customers')}>Customers</button>
            </div>
          )}
        </div>
        <IndiaMap stateValues={mapValues} points={crm ? d.points : []} format={mapMetric === 'sales' && fin ? money : String}
          valueLabel={mapMetric === 'sales' && fin ? 'Sales' : 'Customers'} pointLabel="Customers" height={440} />
      </div>
      <div className="card">
        <h2>Needs attention ({alerts.length})</h2>
        <AlertList alerts={alerts} limit={9} />
      </div>
    </div>
  ) });
  if (fin) blocks.push({ key: 'cash', label: 'Cash flow', el: <ChartCard title={`Cash flow · ${periodName}`} data={d.trend} kinds={['bar', 'line']} format={money} /> });
  if (fin) blocks.push({ key: 'category', label: 'Sales by product category', el: <ChartCard title="Sales by product category" data={d.catData} kinds={['donut', 'hbar']} format={money} /> });
  if (crm) blocks.push({ key: 'funnel', label: 'Lead pipeline', el: <ChartCard title="Lead pipeline (all open and closed)" data={d.funnel} kinds={['hbar', 'bar']} /> });
  if (crm) blocks.push({ key: 'sources', label: 'Lead sources', el: <ChartCard title={`Lead sources · ${periodName}`} data={d.sources} kinds={['donut', 'hbar']} /> });
  if (canRead(store.user, 'projects') && d.bySize.labels.length) blocks.push({ key: 'sizes', label: 'Systems by size', el: <ChartCard title={`Systems by size · installed ${periodName} and in progress`} data={d.bySize} kinds={['bar', 'hbar']} /> });
  if (canRead(store.user, 'projects')) blocks.push({ key: 'stages', label: 'Projects by stage', el: <ChartCard title="Projects by stage" data={d.projStages} kinds={['hbar', 'donut']} /> });
  if (fin) blocks.push({ key: 'top', label: 'Top customers', el: <ChartCard title={`Top customers · ${periodName}`} data={d.topCustomers} kinds={['hbar', 'donut']} format={money} /> });
  if (crm) blocks.push({ key: 'followups', label: 'Upcoming follow-ups', el: (
    <div className="card">
      <h2>Upcoming follow-ups</h2>
      {followUps.length ? (
        <ul className="alert-list">
          {followUps.map((l) => (
            <li key={l.id}><Link to={`/m/leads/${l.id}`}><span className="muted small" style={{ minWidth: 150 }}>{formatDate(l.nextFollowUp)}</span><span>{String(l.name)}</span></Link></li>
          ))}
        </ul>
      ) : <p className="muted">No follow-ups scheduled.</p>}
    </div>
  ) });
  if (canRead(store.user, 'installation')) blocks.push({ key: 'installs', label: 'Installation schedule', el: (
    <div className="card">
      <h2>Installation schedule</h2>
      {upcoming.length ? (
        <ul className="alert-list">
          {upcoming.map((i) => (
            <li key={i.id}><Link to={`/m/installations/${i.id}`}><span className="muted small" style={{ minWidth: 110 }}>{formatDate(i.scheduledDate)}</span><span>{i.number} · {store.titleOf('projects', i.projectId)}</span></Link></li>
          ))}
        </ul>
      ) : <p className="muted">Nothing scheduled.</p>}
    </div>
  ) });

  // Items the person added (charts, KPIs, lists, map, alerts, notes) sit with the standard sections.
  for (const it of extra) {
    const h = it.h * 96 + (it.h - 1) * 14;
    blocks.push({ key: `x:${it.id}`, label: it.title || 'My item', wide: it.w >= 8, el: (
      <div className="card ditem dash-extra" style={{ minHeight: h + 32 }}><ItemView item={it} range={r} height={h} /></div>
    ) });
  }
  const editItem = (key: string) => { const it = extra.find((x) => `x:${x.id}` === key); if (it) setEditor({ item: it, isNew: false }); };
  const removeItem = (key: string) => save({ ...layout, items: extra.filter((x) => `x:${x.id}` !== key), blocks: layout.blocks.filter((k) => k !== key), hidden: layout.hidden.filter((k) => k !== key) });

  const kpiKeys = kpis.map((k) => k.label);
  const kOrder = arrange(layout.kpis, kpiKeys);
  const bOrder = arrange(layout.blocks, blocks.map((b) => b.key));
  const shownK = editing ? kOrder : kOrder.filter((k) => !layout.hidden.includes(k));
  const shownB = editing ? bOrder : bOrder.filter((k) => !layout.hidden.includes(k));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="muted small">{formatDate(today)}</div>
          <h1>Dashboard</h1>
        </div>
        <div className="spacer" />
        <div className="seg" role="group" aria-label="Period">
          {PERIODS.map((p) => <button key={p.key} type="button" className={period === p.key ? 'on' : ''} aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
        </div>
        <button type="button" className="btn" onClick={addItem}>+ Add item</button>
        {editing ? <>
          <button type="button" className="btn" onClick={() => save({ kpis: [], blocks: [], hidden: [], items: extra })}>Reset order</button>
          <button type="button" className="btn primary" onClick={() => setEditing(false)}>Done</button>
        </> : <button type="button" className="btn" onClick={() => setEditing(true)}>✎ Customize</button>}
      </div>
      {editing && <p className="muted small dash-help">Drag ⠿ or use the arrows to change the order, 👁 to hide or show, <strong>+ Add item</strong> for a chart, KPI, list, map or note of your own (✎ edits it, ✕ removes it). {store.mode === 'cloud' ? 'Saved to your account as you go — the same order on your phone and computer.' : 'Saved on this device as you go.'}</p>}
      <div className={'kpis' + (editing ? ' arranging' : '')}>
        {shownK.map((key, i) => {
          const k = kpis.find((x) => x.label === key)!;
          const hidden = layout.hidden.includes(key);
          const inner = <>
            <div className="label">{k.label}{['Invoiced', 'Collected', 'New leads', 'Installed'].includes(k.label) ? <span className="muted"> · {periodName}</span> : null}</div>
            <div className="value" title={'full' in k ? String(k.full) : undefined}>{k.value}</div>
            <div className="sub">{k.sub}</div>
          </>;
          return editing
            ? <Arrangeable key={key} itemKey={key} label={k.label} hidden={hidden} first={i === 0} last={i === shownK.length - 1} className="card kpi"
                onMove={(dir) => save({ ...layout, kpis: shift(kOrder, key, dir) })} onDrop={(from) => save({ ...layout, kpis: dropBefore(kOrder, from, key) })}
                onToggle={() => save({ ...layout, hidden: hidden ? layout.hidden.filter((x) => x !== key) : [...layout.hidden, key] })} dragGroup="kpi">{inner}</Arrangeable>
            : <Link key={key} to={k.to} className="card kpi">{inner}</Link>;
        })}
      </div>

      <div className={'grid grid-2 dash-blocks' + (editing ? ' arranging' : '')}>
        {shownB.map((key, i) => {
          const b = blocks.find((x) => x.key === key)!;
          const hidden = layout.hidden.includes(key);
          return editing
            ? <Arrangeable key={key} itemKey={key} label={b.label} hidden={hidden} first={i === 0} last={i === shownB.length - 1} className={'block' + (b.wide ? ' wide' : '')}
                onMove={(dir) => save({ ...layout, blocks: shift(bOrder, key, dir) })} onDrop={(from) => save({ ...layout, blocks: dropBefore(bOrder, from, key) })}
                onToggle={() => save({ ...layout, hidden: hidden ? layout.hidden.filter((x) => x !== key) : [...layout.hidden, key] })} dragGroup="block"
                onEdit={key.startsWith('x:') ? () => editItem(key) : undefined} onRemove={key.startsWith('x:') ? () => removeItem(key) : undefined}>{b.el}</Arrangeable>
            : <div key={key} className={'block' + (b.wide ? ' wide' : '')}>{b.el}</div>;
        })}
      </div>
      {editor && (
        <ItemEditor initial={editor.item} isNew={editor.isNew} range={r} onCancel={() => { setEditor(null); if (editor.isNew && !editingBefore.current) setEditing(false); }}
          onSave={(item) => {
            const it = clampItem(item);
            save({ ...layout, items: editor.isNew ? [...extra, it] : extra.map((x) => (x.id === it.id ? it : x)) });
            setEditor(null);
          }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- the person's own order of tiles and sections
interface DashLayout { kpis: string[]; blocks: string[]; hidden: string[]; items?: DashItem[] }
const layoutKey = (uid: string) => `ss1:defdash:${uid}`;
function loadLayout(uid: string): DashLayout {
  try {
    const v = JSON.parse(localStorage.getItem(layoutKey(uid)) || 'null') as DashLayout | null;
    if (v && Array.isArray(v.kpis) && Array.isArray(v.blocks) && Array.isArray(v.hidden)) {
      return { ...v, items: Array.isArray(v.items) ? v.items.filter((x) => x && typeof x.id === 'string').map(clampItem) : [] };
    }
  } catch { /* fall through */ }
  return { kpis: [], blocks: [], hidden: [] };
}
function saveLayout(uid: string, l: DashLayout) {
  try { localStorage.setItem(layoutKey(uid), JSON.stringify(l)); } catch { /* storage blocked: the order lasts until reload */ }
  pushPref('defdash', l);
}
/** Saved order first (only keys that still exist), then anything new in its natural place at the end. */
export function arrange(saved: string[], keys: string[]): string[] {
  return [...saved.filter((k) => keys.includes(k)), ...keys.filter((k) => !saved.includes(k))];
}
export function shift(order: string[], key: string, dir: -1 | 1): string[] {
  const i = order.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
export function dropBefore(order: string[], from: string, to: string): string[] {
  if (from === to || !order.includes(from) || !order.includes(to)) return order;
  const rest = order.filter((k) => k !== from);
  rest.splice(rest.indexOf(to), 0, from);
  return rest;
}

/** A tile or section while customising: drag it (mouse), or use the arrow buttons (touch, keyboard); hide or show it. */
function Arrangeable({ itemKey, label, hidden, first, last, className, onMove, onDrop, onToggle, onEdit, onRemove, dragGroup, children }: {
  itemKey: string; label: string; hidden: boolean; first: boolean; last: boolean; className: string; dragGroup: string;
  onMove: (dir: -1 | 1) => void; onDrop: (fromKey: string) => void; onToggle: () => void; onEdit?: () => void; onRemove?: () => void; children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div className={`${className} arrangeable${hidden ? ' is-hidden' : ''}${over ? ' drop' : ''}`} aria-label={`${label}${hidden ? ' (hidden)' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(`ss1/${dragGroup}`)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { const from = e.dataTransfer.getData(`ss1/${dragGroup}`); setOver(false); if (from) { e.preventDefault(); onDrop(from); } }}>
      <div className="arrange-tools">
        <span className="drag" draggable aria-hidden title="Drag to move" onDragStart={(e) => { e.dataTransfer.setData(`ss1/${dragGroup}`, itemKey); e.dataTransfer.effectAllowed = 'move'; }}>⠿</span>
        <button type="button" className="btn ghost sm" aria-label={`Move ${label} earlier`} disabled={first} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="btn ghost sm" aria-label={`Move ${label} later`} disabled={last} onClick={() => onMove(1)}>↓</button>
        <button type="button" className="btn ghost sm" aria-pressed={!hidden} aria-label={hidden ? `Show ${label}` : `Hide ${label}`} title={hidden ? 'Show' : 'Hide'} onClick={onToggle}>{hidden ? '🚫' : '👁'}</button>
        {onEdit && <button type="button" className="btn ghost sm" aria-label={`Edit ${label}`} title="Edit" onClick={onEdit}>✎</button>}
        {onRemove && <button type="button" className="btn ghost sm" aria-label={`Remove ${label}`} title="Remove" onClick={onRemove}>✕</button>}
      </div>
      <div className="arrange-body">{children}</div>
    </div>
  );
}

