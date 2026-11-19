import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Entity, Rec } from '../../lib/schema';
import { useStore } from '../../lib/store';
import { STATE_SHAPES, VIEWBOX } from '../../lib/geo/indiaMap';
import {
  DISTRICT_POINTS, PX_MIN, PX_RECORD, REF_CITIES, cityBubbles, spreadApart, fitBox, levelFor, placeLabels, placePoints, recordBubbles, stateBounds, stateBubbles,
  type Box, type Bubble, type Label, type MapPoint, type PlacedPoint,
} from '../../lib/geo/mapLayers';
import { recordLocation } from '../../lib/geo/locate';
import { STATES } from '../../lib/states';
import { money, round2 } from '../../lib/money';

export type { MapPoint } from '../../lib/geo/mapLayers';

export const MAP_ATTRIBUTION = 'Boundaries © DataMeet India community (CC BY 4.0), simplified · PIN locations: Department of Posts, data.gov.in (GODL-India) · Places: GeoNames (CC BY 4.0). Approximate locations; not an official Survey of India map.';

const STEPS = 6;
const FULL: Box = { x: 0, y: 0, w: VIEWBOX.width, h: VIEWBOX.height };

/** Sequential shade index 1..6 for a value, 0 for nothing. Square-root scale so one big state does not wash out the rest. */
export function shadeStep(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(STEPS, Math.max(1, Math.ceil(Math.sqrt(value / max) * STEPS)));
}

const LEVEL_TEXT = { state: 'by state · zoom in or pick a state to see cities', city: 'by city · zoom in to see each one', record: 'each one shown' };

interface Props {
  stateValues?: Record<string, number>;
  points?: MapPoint[];
  format?: (n: number) => string;
  valueLabel?: string;
  pointLabel?: string;
  height?: number;
  /** records under a clicked city bubble */
  onPick?: (items: PlacedPoint[]) => void;
  /** chosen state filter; leave undefined to let the map keep its own */
  selectedState?: string | null;
  onStateChange?: (state: string | null) => void;
}

export function IndiaMap({ stateValues = {}, points = [], format = (n: number) => String(n), valueLabel = 'Value', pointLabel = 'Locations', height = 420, onPick, selectedState, onStateChange }: Props) {
  const nav = useNavigate();
  const [vb, setVb] = useState<Box>(FULL);
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const [ownState, setOwnState] = useState<string | null>(null);
  const sel = selectedState !== undefined ? selectedState : ownState;
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub?: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const max = Math.max(0, ...Object.values(stateValues));

  // Dots and labels are sized in screen pixels, whatever the zoom or the size of the box.
  const [box, setBox] = useState({ w: 600, h: height });
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width > 0) setBox({ w: e.contentRect.width, h: e.contentRect.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pxOf = (b: Box) => 1 / Math.min(box.w / b.w, box.h / b.h); // map units per screen pixel
  const px = pxOf(vb);
  const isFull = px >= pxOf(FULL) * 0.999;

  const placed = useMemo(() => placePoints(points), [points]);
  const shown = useMemo(() => (sel ? placed.filter((p) => p.state === sel) : placed), [placed, sel]);
  const level = levelFor(px, !!sel);
  const bubbles = useMemo(() => {
    if (level === 'state') {
      const raw = stateBubbles(shown);
      const most = Math.max(1, ...raw.map((b) => b.items.length));
      return spreadApart(raw, (b) => (9 + 13 * Math.sqrt(b.items.length / most)) * px, 3 * px);
    }
    if (level === 'city') return cityBubbles(shown, px);
    return recordBubbles(shown, px);
  }, [shown, level, px]);
  const biggest = Math.max(1, ...bubbles.map((b) => b.items.length));
  const radius = (b: Bubble) => b.kind === 'record' ? 5.5
    : (b.kind === 'state' ? 9 + 13 * Math.sqrt(b.items.length / biggest) : 7 + 9 * Math.sqrt(b.items.length / biggest));

  // ---- moving the view ----
  const anim = useRef(0);
  const clamp = (b: Box): Box => {
    let { w, h } = b;
    const p = pxOf({ ...b, w, h });
    if (p < PX_MIN) { w *= PX_MIN / p; h *= PX_MIN / p; }
    if (pxOf({ x: 0, y: 0, w, h }) >= pxOf(FULL)) return FULL;
    const cx = Math.min(Math.max(b.x + b.w / 2, 0), FULL.w), cy = Math.min(Math.max(b.y + b.h / 2, 0), FULL.h);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  };
  const animateTo = (target: Box) => {
    const to = clamp(target);
    cancelAnimationFrame(anim.current);
    const from = vbRef.current;
    const still = typeof requestAnimationFrame !== 'function'
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (still) { setVb(to); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 320), e = 1 - (1 - k) ** 3;
      setVb({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e });
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(anim.current), []);
  const zoomAt = (f: number, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2, smooth = true) => {
    const next = { x: cx - (cx - vb.x) / f, y: cy - (cy - vb.y) / f, w: vb.w / f, h: vb.h / f };
    if (smooth) animateTo(next); else setVb(clamp(next));
  };
  const aspect = box.h / box.w;
  const stateBox = (name: string) => {
    const b = stateBounds(name);
    return b ? fitBox([{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }], aspect, 0, 0.06) : FULL;
  };

  const choose = (state: string | null) => {
    setOwnState(state);
    onStateChange?.(state);
  };
  // Picking a state (here or from outside the map) flies there; "All India" flies back out.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; if (!sel) return; }
    animateTo(sel ? stateBox(sel) : FULL);
    setTip(null);
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- mouse, touch and pinch ----
  const toSvg = (clientX: number, clientY: number, v = vb) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return { x: 0, y: 0, px: 0, py: 0 };
    const s = Math.min(r.width / v.w, r.height / v.h);
    const ox = (r.width - v.w * s) / 2, oy = (r.height - v.h * s) / 2;
    return { x: v.x + (clientX - r.left - ox) / s, y: v.y + (clientY - r.top - oy) / s, px: clientX - r.left, py: clientY - r.top };
  };
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ vb: Box; x: number; y: number; dist: number; at: { x: number; y: number } } | null>(null);
  const dragged = useRef(false);
  const begin = () => {
    const ps = [...ptrs.current.values()];
    if (!ps.length) { gesture.current = null; return; }
    const x = ps.reduce((s, p) => s + p.x, 0) / ps.length, y = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    const dist = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    gesture.current = { vb: vbRef.current, x, y, dist, at: toSvg(x, y, vbRef.current) };
  };
  const down = (e: RPointerEvent) => {
    cancelAnimationFrame(anim.current);
    if (!ptrs.current.size) dragged.current = false;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    begin();
  };
  const move = (e: RPointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const ps = [...ptrs.current.values()];
    const s = 1 / pxOf(g.vb);
    if (ps.length > 1 && g.dist > 0) {
      const f = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / g.dist;
      dragged.current = true;
      setVb(clamp({ x: g.at.x - (g.at.x - g.vb.x) / f, y: g.at.y - (g.at.y - g.vb.y) / f, w: g.vb.w / f, h: g.vb.h / f }));
      return;
    }
    const dx = (e.clientX - g.x) / s, dy = (e.clientY - g.y) / s;
    if (Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 4) dragged.current = true;
    if (dragged.current && !isFull) setVb(clamp({ ...g.vb, x: g.vb.x - dx, y: g.vb.y - dy }));
  };
  const up = (e: RPointerEvent) => { ptrs.current.delete(e.pointerId); begin(); };
  // Ctrl + wheel (and two-finger pinch on a touchpad) zooms; a plain wheel still scrolls the page.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY, vbRef.current);
      const v = vbRef.current, f = Math.exp(-e.deltaY * 0.01);
      setVb(clamp({ x: p.x - (p.x - v.x) / f, y: p.y - (p.y - v.y) / f, w: v.w / f, h: v.h / f }));
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  });

  const showTip = (e: { clientX: number; clientY: number }, text: string, sub?: string) => {
    const p = toSvg(e.clientX, e.clientY);
    setTip({ x: p.px, y: p.py, text, sub });
  };
  const open = (b: Bubble) => {
    if (dragged.current) return;
    setTip(null);
    if (b.kind === 'state') choose(b.name);
    else if (b.kind === 'city') {
      onPick?.(b.items);
      // Close enough to see each record, wider only if the records are spread out.
      animateTo(fitBox(b.items, aspect, box.w * PX_RECORD * 0.85));
    } else if (b.items[0].to) nav(b.items[0].to);
  };
  const keyOpen = (e: RKeyboardEvent, b: Bubble) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dragged.current = false; open(b); } };

  // ---- labels: city bubbles first, then reference cities, then state names ----
  const labels = useMemo(() => {
    const markers = bubbles.map((b) => ({ x: b.x, y: b.y, r: (radius(b) + 2) * px }));
    const c: Label[] = [];
    for (const b of bubbles) {
      if (b.kind === 'state') continue;
      c.push({ x: b.x, y: b.y, text: b.kind === 'city' && b.more ? `${b.name} +${b.more}` : b.name, size: b.kind === 'city' ? 12 : 11,
        priority: b.kind === 'city' ? 1 : 2, gap: radius(b) + 6, kind: 'hit' });
    }
    // Whole India: state names only. Zoomed in: the big cities first, smaller ones the closer you get.
    const tiers = level === 'state' ? 0 : px <= 0.6 ? 3 : px <= 1.3 ? 2 : 1;
    const named = new Set(bubbles.filter((b) => b.kind === 'city').map((b) => b.name.toLowerCase()));
    for (const r of REF_CITIES) {
      // No second label for a city that already has a marker, or whose dot a marker hides.
      if (r.tier > tiers || named.has(r.name.toLowerCase()) || markers.some((m) => Math.hypot(m.x - r.x, m.y - r.y) < m.r)) continue;
      c.push({ x: r.x, y: r.y, text: r.name, size: 10.5, priority: 3 + r.tier / 10, gap: 4, kind: 'place' });
    }
    // Zoomed in: district names — all of the chosen state's first, then those of neighbours in view.
    if (level !== 'state') {
      const taken = new Set([...named, ...c.filter((x) => x.kind === 'place').map((x) => x.text.toLowerCase())]);
      for (const d of DISTRICT_POINTS) {
        if (d.x < vb.x || d.x > vb.x + vb.w || d.y < vb.y || d.y > vb.y + vb.h || taken.has(d.name.toLowerCase())) continue;
        const mine = !sel || d.state === sel;
        c.push({ x: d.x, y: d.y, text: d.name, size: mine ? 9.5 : 8.5, priority: mine ? 2.6 : 4, kind: 'district' });
      }
    }
    for (const s of STATE_SHAPES) {
      // On the whole-India view the state names lead (beside the state's bubble if it has one); zoomed in they give way to cities.
      const own = level === 'state' ? bubbles.find((b) => b.kind === 'state' && b.name === s.name) : undefined;
      c.push({
        x: own ? own.x : s.cx, y: own ? own.y : s.cy, text: level === 'state' ? short(s.name) : s.name.toUpperCase(),
        size: level === 'state' ? 9 : 9.5, priority: level === 'state' ? (own ? 2 : 2.5) : 5, kind: 'state',
        ...(own ? { gap: radius(own) + 4 } : {}),
      });
    }
    return placeLabels(c, px, vb, markers);
  }, [bubbles, sel, px, vb, level]); // eslint-disable-line react-hooks/exhaustive-deps

  // The dot of each reference city whose name is shown.
  const places = labels.filter((l) => l.kind === 'place').map((l) => {
    const c = REF_CITIES.find((r) => r.name === l.text)!;
    return { text: l.text, x: c.x, y: c.y };
  });

  // ---- state filter ----
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of placed) if (p.state) m[p.state] = (m[p.state] || 0) + 1;
    return m;
  }, [placed]);
  const withData = STATES.filter((s) => counts[s] || stateValues[s]);
  const optionText = (s: string) => `${s}${counts[s] ? ` (${counts[s]})` : ''}`;

  return (
    <div className="india-map">
      <div className="map-bar no-print">
        <label className="sr-only" htmlFor="map-state">Show state</label>
        <select id="map-state" className="input map-filter" value={sel || ''} onChange={(e) => choose(e.target.value || null)}>
          <option value="">All India{placed.length ? ` (${placed.length})` : ''}</option>
          {withData.length > 0 && <optgroup label="With data">{withData.map((s) => <option key={s} value={s}>{optionText(s)}</option>)}</optgroup>}
          <optgroup label="All states and UTs">{STATES.filter((s) => !withData.includes(s)).map((s) => <option key={s} value={s}>{s}</option>)}</optgroup>
        </select>
        <div className="spacer" />
        <button type="button" className="btn sm" aria-label="Zoom in" onClick={() => zoomAt(1.8)} disabled={px <= PX_MIN * 1.01}>+</button>
        <button type="button" className="btn sm" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.8)} disabled={isFull}>−</button>
        <button type="button" className="btn sm" onClick={() => { choose(null); animateTo(FULL); }} disabled={isFull && !sel}>All India</button>
      </div>
      <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} style={{ height, width: '100%', touchAction: isFull ? 'pan-y' : 'none' }}
        preserveAspectRatio="xMidYMid meet" role="group" data-level={level} data-px={px.toFixed(3)}
        aria-label={`Map of India${sel ? `, ${sel}` : ''}: ${valueLabel.toLowerCase()} by state${points.length ? `, ${shown.length} ${pointLabel.toLowerCase()} shown as ${level === 'state' ? 'state' : level === 'city' ? 'city' : 'single'} markers` : ''}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onPointerLeave={(e) => { up(e); setTip(null); }}
        onDoubleClick={(e) => { const p = toSvg(e.clientX, e.clientY); zoomAt(2, p.x, p.y); }}>
        <g>
          {STATE_SHAPES.map((st) => {
            const v = stateValues[st.name] || 0;
            const step = shadeStep(v, max);
            return (
              <path key={st.name} d={st.d} className={'map-state' + (sel && sel !== st.name ? ' dim' : '') + (sel === st.name ? ' on' : '')}
                fill={step ? `var(--seq-${step})` : 'var(--map-empty)'} strokeWidth={sel === st.name ? 1.6 : 0.7} vectorEffect="non-scaling-stroke"
                onClick={() => { if (!dragged.current && sel !== st.name) choose(st.name); }}
                onMouseMove={(e) => showTip(e, st.name, `${v ? `${valueLabel}: ${format(v)}` : 'No data'}${counts[st.name] ? ` · ${counts[st.name]} ${pointLabel.toLowerCase()}` : ''}`)}
                onMouseLeave={() => setTip(null)}>
                <title>{`${st.name}${v ? ` — ${format(v)}` : ''}`}</title>
              </path>
            );
          })}
        </g>
        <g className="map-places" aria-hidden>
          {places.map((l) => <circle key={l.text} cx={l.x} cy={l.y} r={2 * px} />)}
        </g>
        <g>
          {bubbles.filter((b) => b.anchor).map((b) => (
            <line key={'l' + b.key} x1={b.anchor!.x} y1={b.anchor!.y} x2={b.x} y2={b.y} className="map-leader" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          {bubbles.map((b) => {
            const n = b.items.length;
            const r = radius(b) * px;
            const name = b.kind === 'record' ? b.name : `${b.name}${b.more ? ` and ${b.more} nearby` : ''}: ${n} ${pointLabel.toLowerCase()}`;
            const top = b.kind === 'state' ? topCities(b.items) : b.items.slice(0, 3).map((x) => x.label).join(', ') + (n > 3 ? '…' : '');
            return (
              <g key={b.key} className={'map-dot ' + b.kind} role="button" tabIndex={0} aria-label={name}
                onClick={() => open(b)} onKeyDown={(e) => keyOpen(e, b)}
                onMouseMove={(e) => showTip(e, b.kind === 'record' ? b.name : `${b.name}${b.more ? ` +${b.more} nearby` : ''}`,
                  b.kind === 'record' ? b.items[0].city : `${n} ${pointLabel.toLowerCase()}${top ? ` · ${top}` : ''}`)}
                onMouseLeave={() => setTip(null)}>
                <circle cx={b.x} cy={b.y} r={r + 2 * px} fill="var(--surface)" />
                <circle cx={b.x} cy={b.y} r={r} fill="var(--c2)" />
                {b.kind !== 'record' && <text x={b.x} y={b.y} textAnchor="middle" dominantBaseline="central" className="map-count" style={{ fontSize: (n > 99 ? 9 : 11) * px }}>{n}</text>}
              </g>
            );
          })}
        </g>
        <g className="map-labels" aria-hidden>
          {labels.map((l, i) => (
            <text key={i} x={l.x} y={l.y} textAnchor={l.anchor} dominantBaseline="central"
              className={l.kind === 'state' ? 'state-name' : l.kind === 'place' ? 'place' : l.kind === 'district' ? 'district' : 'hit'} style={{ fontSize: l.size * px, strokeWidth: 3 * px }}>{l.text}</text>
          ))}
        </g>
      </svg>
      {tip && <div className="chart-tip" style={{ left: tip.x, top: tip.y - 8 }}><strong>{tip.text}</strong>{tip.sub && <div>{tip.sub}</div>}</div>}
      <div className="map-legend">
        {max > 0 && (
          <span className="map-scale" aria-label={`${valueLabel}: lighter is less, darker is more`}>
            <span className="muted small">{valueLabel}</span>
            {Array.from({ length: STEPS }, (_, i) => <i key={i} style={{ background: `var(--seq-${i + 1})` }} />)}
            <span className="muted small">up to {format(max)}</span>
          </span>
        )}
        {points.length > 0 && (
          <span className="small"><i className="dot" /> {pointLabel} ({shown.length}{sel ? ` in ${sel}` : ''}) · {LEVEL_TEXT[level]}</span>
        )}
      </div>
      <p className="map-attr">{MAP_ATTRIBUTION}</p>
    </div>
  );
}

/** Shorter state names for the whole-India view, where space is tight. */
const SHORT: Record<string, string> = {
  'Andaman and Nicobar Islands': 'A & N Islands', 'Dadra and Nagar Haveli and Daman and Diu': 'DNH & DD',
  'Jammu and Kashmir': 'J & K', 'Arunachal Pradesh': 'Arunachal', 'Himachal Pradesh': 'Himachal',
  'Madhya Pradesh': 'Madhya Pradesh', 'Andhra Pradesh': 'Andhra Pradesh', 'Uttar Pradesh': 'Uttar Pradesh',
};
const short = (n: string) => SHORT[n] || n;

function topCities(items: PlacedPoint[]): string {
  const m = new Map<string, number>();
  for (const p of items) m.set(p.city, (m.get(p.city) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} ${n}`).join(', ');
}

/** Map view for any list: records by state, city and one by one; states shaded by how many records are there. */
export function EntityMap({ entity, rows }: { entity: Entity; rows: Rec[] }) {
  const store = useStore();
  const [picked, setPicked] = useState<{ title: string; items: PlacedPoint[] } | null>(null);
  const [state, setState] = useState<string | null>(null);
  const money1 = entity.computed?.find((c) => c.type === 'money');
  const [metric, setMetric] = useState<'count' | 'value'>('count');
  const data = useMemo(() => {
    const points: MapPoint[] = [];
    const byState: Record<string, number> = {};
    let missing = 0;
    for (const r of rows) {
      const loc = recordLocation(store, entity.key, r);
      if (!loc) { missing++; continue; }
      const v = metric === 'value' && money1 ? store.computed(entity.key, r)[money1.key] || 0 : 1;
      if (loc.state) byState[loc.state] = round2((byState[loc.state] || 0) + v);
      points.push({ lat: loc.lat, lng: loc.lng, state: loc.state, city: loc.city, label: store.titleOf(entity.key, r.id), to: `/m/${entity.key}/${r.id}` });
    }
    return { points, byState, missing };
  }, [store, store.getVersion(), entity, rows, metric, money1]);
  const placed = useMemo(() => placePoints(data.points), [data.points]);
  const top = Object.entries(data.byState).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const fmt = metric === 'value' ? money : (n: number) => String(n);
  const cities = useMemo(() => {
    const m = new Map<string, PlacedPoint[]>();
    for (const p of placed) if (p.state === state) m.set(p.city, [...(m.get(p.city) || []), p]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [placed, state]);
  const pickState = (s: string | null) => { setState(s); setPicked(null); };

  return (
    <div className="grid map-layout">
      <div className="card">
        <div className="chart-head">
          <h2>{entity.plural} across {state || 'India'}</h2>
          {money1 && (
            <div className="seg" role="group" aria-label="Shade states by">
              <button type="button" className={metric === 'count' ? 'on' : ''} aria-pressed={metric === 'count'} onClick={() => setMetric('count')}>Count</button>
              <button type="button" className={metric === 'value' ? 'on' : ''} aria-pressed={metric === 'value'} onClick={() => setMetric('value')}>{money1.label}</button>
            </div>
          )}
        </div>
        <IndiaMap stateValues={data.byState} points={data.points} format={fmt} valueLabel={metric === 'value' && money1 ? money1.label : entity.plural}
          pointLabel={entity.plural} height={500} selectedState={state} onStateChange={pickState}
          onPick={(items) => setPicked({ title: items[0]?.city || 'Here', items })} />
        {data.missing > 0 && <p className="muted small">{data.missing} {data.missing === 1 ? 'record has' : 'records have'} no PIN code, city, state or GPS location, so {data.missing === 1 ? 'it is' : 'they are'} not on the map.</p>}
      </div>
      <div className="card">
        {picked ? <>
          <div className="chart-head"><h2>{picked.title} · {picked.items.length}</h2><button className="btn sm" onClick={() => setPicked(null)}>Back</button></div>
          <ul className="alert-list">{picked.items.slice(0, 100).map((p, i) => <li key={i}><Link to={p.to || '#'}>{p.label}</Link></li>)}</ul>
          {picked.items.length > 100 && <p className="muted small">Showing the first 100.</p>}
        </> : state ? <>
          <div className="chart-head"><h2>{state} · cities</h2><button className="btn sm" onClick={() => pickState(null)}>All India</button></div>
          {cities.length ? (
            <table className="map-table"><tbody>{cities.map(([c, items]) => (
              <tr key={c}><td><button type="button" className="link-btn" onClick={() => setPicked({ title: c, items })}>{c}</button></td><td className="num">{items.length}</td></tr>
            ))}</tbody></table>
          ) : <p className="muted">No {entity.plural.toLowerCase()} with a location in {state}.</p>}
        </> : <>
          <h2>Top states</h2>
          {top.length ? (
            <table className="map-table"><tbody>{top.map(([st, v]) => (
              <tr key={st}><td><button type="button" className="link-btn" onClick={() => pickState(st)}>{st}</button></td><td className="num">{fmt(v)}</td></tr>
            ))}</tbody></table>
          ) : <p className="muted">Add a PIN code, city or state to records to see them here.</p>}
        </>}
      </div>
    </div>
  );
}
