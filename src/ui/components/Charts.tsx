import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface Series { name: string; values: number[] }
export interface ChartData { labels: string[]; series: Series[] }
export type ChartKind = 'bar' | 'line' | 'donut' | 'hbar';

/** Short Indian-style amount for axes: 950, 12.5K, 3.2L, 1.4Cr. */
export function compactNumber(n: number, rupee = false): string {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  const p = rupee ? '₹' : '';
  const trim = (x: number) => (x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ''));
  if (a >= 1e7) return `${sign}${p}${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}${p}${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}${p}${trim(a / 1e3)}K`;
  return `${sign}${p}${Number.isInteger(a) ? a : a.toFixed(1)}`;
}

/** 0 → a round maximum, with 4–5 evenly spaced ticks. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
}

const color = (i: number) => `var(--c${(i % 8) + 1})`;

function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { const cw = Math.round(e.contentRect.width); if (cw > 0) setW(cw); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="legend">
      {series.map((s, i) => <span key={s.name}><i style={{ background: color(i) }} />{s.name}</span>)}
    </div>
  );
}

function Tip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), Math.max(70, w - 70));
  return <div className="chart-tip" style={{ left, top: y }}>{children}</div>;
}

/** Vertical bars (grouped when there are several series) or lines, sharing one y-axis. */
function XYChart({ data, kind, format, height = 240 }: { data: ChartData; kind: 'bar' | 'line'; format: (n: number) => string; height?: number }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const { labels, series } = data;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const pad = { l: 52, r: 12, t: 12, b: 30 };
  const iw = Math.max(10, width - pad.l - pad.r), ih = height - pad.t - pad.b;
  const band = iw / Math.max(1, labels.length);
  const y = (v: number) => pad.t + ih - (Math.max(0, v) / top) * ih;
  const xMid = (i: number) => pad.l + band * i + band / 2;
  // Thin labels so they never collide.
  const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(iw / 64))));
  const groupW = Math.min(band * 0.72, 18 * series.length + 2 * (series.length - 1));
  const barW = Math.max(2, (groupW - 2 * (series.length - 1)) / series.length);

  return (
    <div ref={ref} className="chart" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={`${kind === 'bar' ? 'Bar' : 'Line'} chart: ${series.map((s) => s.name).join(', ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={pad.l - 6} y={y(t)} className="axis-text" textAnchor="end" dominantBaseline="middle">{compactNumber(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % every === 0 ? (
          <text key={l + i} x={xMid(i)} y={height - 10} className="axis-text" textAnchor="middle">{l}</text>
        ) : null))}
        {hover !== null && <rect x={pad.l + band * hover} y={pad.t} width={band} height={ih} className="hover-band" />}
        {kind === 'bar' && series.map((s, si) => s.values.map((v, i) => {
          const x = xMid(i) - groupW / 2 + si * (barW + 2);
          const h = Math.max(0, y(0) - y(v));
          const r = Math.min(4, barW / 2, h);
          // Rounded top, square base on the axis.
          const d = h <= 0 ? '' : `M${x},${y(0)}V${y(v) + r}Q${x},${y(v)} ${x + r},${y(v)}H${x + barW - r}Q${x + barW},${y(v)} ${x + barW},${y(v) + r}V${y(0)}Z`;
          return d ? <path key={si + '-' + i} d={d} fill={color(si)} /> : null;
        }))}
        {kind === 'line' && series.map((s, si) => (
          <g key={s.name}>
            <polyline fill="none" stroke={color(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              points={s.values.map((v, i) => `${xMid(i)},${y(v)}`).join(' ')} />
            {s.values.map((v, i) => (labels.length <= 24 || hover === i
              ? <circle key={i} cx={xMid(i)} cy={y(v)} r={hover === i ? 5 : 3.5} fill={color(si)} stroke="var(--surface)" strokeWidth={2} />
              : null))}
          </g>
        ))}
        {labels.map((_, i) => (
          <rect key={'hit' + i} x={pad.l + band * i} y={pad.t} width={band} height={ih + pad.b} fill="transparent"
            onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <Tip x={xMid(hover)} y={pad.t} w={width}>
          <strong>{labels[hover]}</strong>
          {series.map((s, si) => <div key={s.name}><i style={{ background: color(si) }} />{series.length > 1 ? `${s.name}: ` : ''}{format(s.values[hover] || 0)}</div>)}
        </Tip>
      )}
      <Legend series={series} />
    </div>
  );
}

/** Part-to-whole for one series. More than 6 slices fold into “Other”. */
function Donut({ data, format }: { data: ChartData; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const s = data.series[0];
  let rows = data.labels.map((l, i) => ({ l, v: Math.max(0, s?.values[i] || 0) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
  if (rows.length > 6) {
    // A real "Other" category joins the folded rest, so "Other" never appears twice.
    const keep = rows.filter((r) => r.l !== 'Other').slice(0, 5);
    const rest = rows.filter((r) => !keep.includes(r));
    rows = [...keep, { l: 'Other', v: rest.reduce((a, r) => a + r.v, 0) }];
  }
  const total = rows.reduce((a, r) => a + r.v, 0);
  if (!total) return <p className="muted">No data yet.</p>;
  const R = 80, r = 52, c = 90;
  let ang = -Math.PI / 2;
  const arcs = rows.map((row, i) => {
    const a0 = ang, a1 = ang + (row.v / total) * Math.PI * 2;
    ang = a1;
    if (rows.length === 1) return { i, d: `M${c},${c - R}A${R},${R} 0 1 1 ${c - 0.01},${c - R}L${c - 0.01},${c - r}A${r},${r} 0 1 0 ${c},${c - r}Z` };
    const gap = 0.012; // a thin surface gap between slices
    const p = (rad: number, a: number) => `${c + rad * Math.cos(a)},${c + rad * Math.sin(a)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return { i, d: `M${p(R, a0 + gap)}A${R},${R} 0 ${large} 1 ${p(R, a1 - gap)}L${p(r, a1 - gap)}A${r},${r} 0 ${large} 0 ${p(r, a0 + gap)}Z` };
  });
  const shown = hover !== null ? rows[hover] : null;
  return (
    <div className="donut-wrap">
      <svg width={180} height={180} viewBox="0 0 180 180" role="img" aria-label={`Donut chart: ${rows.map((x) => `${x.l} ${format(x.v)}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
        {arcs.map((a) => <path key={a.i} d={a.d} fill={color(a.i)} opacity={hover === null || hover === a.i ? 1 : 0.45}
          onMouseEnter={() => setHover(a.i)} onClick={() => setHover(a.i)} />)}
        <text x={c} y={c - 6} textAnchor="middle" className="donut-v">{shown ? format(shown.v) : format(total)}</text>
        <text x={c} y={c + 14} textAnchor="middle" className="axis-text">{shown ? `${Math.round((shown.v / total) * 100)}% · ${shown.l}` : 'Total'}</text>
      </svg>
      <ul className="donut-legend">
        {rows.map((row, i) => (
          <li key={row.l} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <i style={{ background: color(i) }} /><span className="l">{row.l}</span>
            <span className="v">{format(row.v)}</span><span className="muted small">{Math.round((row.v / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars for one series with long category names. */
function HBars({ data, format }: { data: ChartData; format: (n: number) => string }) {
  const s = data.series[0];
  const max = Math.max(0, ...(s?.values || []));
  if (!s || max <= 0) return <p className="muted">No data yet.</p>;
  return (
    <div className="bars" role="img" aria-label={`Bar chart: ${s.name}`}>
      {data.labels.map((l, i) => (
        <div className="bar-row" key={l + i} title={`${l}: ${format(s.values[i] || 0)}`}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l}</span>
          <span className="track"><span className="fill" style={{ width: `${(Math.max(0, s.values[i] || 0) / max) * 100}%` }} /></span>
          <span className="v">{format(s.values[i] || 0)}</span>
        </div>
      ))}
    </div>
  );
}

export function Chart({ data, kind, format = String, height }: { data: ChartData; kind: ChartKind; format?: (n: number) => string; height?: number }) {
  const any = data.labels.length > 0 && data.series.some((s) => s.values.some((v) => v > 0));
  if (!any) return <p className="muted">No data yet.</p>;
  if (kind === 'donut') return <Donut data={data} format={format} />;
  if (kind === 'hbar') return <HBars data={data} format={format} />;
  return <XYChart data={data} kind={kind} format={format} height={height} />;
}

const KIND_LABEL: Record<ChartKind, string> = { bar: 'Bar', line: 'Line', donut: 'Donut', hbar: 'Bars' };

/** A card with a chart, a chart-type switch and a table view of the same numbers. */
export function ChartCard({ title, data, kinds, initial, format = String, extra, height }: {
  title: string; data: ChartData; kinds: ChartKind[]; initial?: ChartKind; format?: (n: number) => string; extra?: ReactNode; height?: number;
}) {
  const [kind, setKind] = useState<ChartKind | 'table'>(initial || kinds[0]);
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <h2>{title}</h2>
        <div className="seg" role="group" aria-label={`${title}: chart type`}>
          {kinds.map((k) => <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
          <button type="button" className={kind === 'table' ? 'on' : ''} aria-pressed={kind === 'table'} onClick={() => setKind('table')}>Table</button>
        </div>
      </div>
      {extra}
      {kind === 'table' ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th />{data.series.map((s) => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
            <tbody>
              {data.labels.map((l, i) => <tr key={l + i}><td>{l}</td>{data.series.map((s) => <td key={s.name} className="num">{format(s.values[i] || 0)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      ) : (
        // Many bars or months keep a readable width and scroll sideways instead of being squeezed.
        <div className="chart-scroll" tabIndex={0} role="region" aria-label={`${title} chart`}><div style={{ minWidth: (kind === 'bar' || kind === 'line') && data.series.some((x) => x.values.some((v) => v)) ? data.labels.length * (data.series.length > 1 ? 56 : 40) : undefined }}>
          <Chart data={data} kind={kind} format={format} height={height} />
        </div></div>
      )}
    </div>
  );
}
