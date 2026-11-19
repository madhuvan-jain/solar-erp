import { ENTITIES } from '../modules/registry';
import { financialYear } from './money';
import type { Rec } from './schema';
// Demo data for testing: a fictional solar company (public/demo/demo-data.json, made by `npm run demo-data`).
// Only ever loaded on a device in device mode, by an admin, and it can be removed again.
import type { DataMap } from './store';
import { workspacePrefix } from './store/workspace';
import { getList, setList } from './store/recordStore';

export interface DemoFile {
  app: string;
  kind: 'demo';
  version: number;
  /** the day the file was made; dates are moved forward from it to the day it is loaded */
  generatedOn: string;
  /** placeholder user id inside the data, replaced by whoever loads it */
  ownerId: string;
  users: { id: string; name: string; email: string; role: string; phone?: string }[];
  data: DataMap;
}

// Per business on this device: demo data loaded in one business is not "loaded" in another.
const FLAG_KEY = () => workspacePrefix() + 'demo';
const BEFORE_KEY = () => workspacePrefix() + 'demo-before';
const COUNTERS_KEY = () => workspacePrefix() + 'demo-before-counters';

export interface DemoState { loadedAt: string; userIds: string[]; hasBefore: boolean }

export function demoState(): DemoState | null {
  try {
    const raw = localStorage.getItem(FLAG_KEY());
    return raw ? (JSON.parse(raw) as DemoState) : null;
  } catch { return null; }
}

/** Fired on window whenever demo data is loaded or removed (the top bar listens). */
export const DEMO_EVENT = 'ss1-demo-change';

/** The flag is small (localStorage); the business's data from before the demo is kept in the file store. */
/** Puts the business's data and numbering aside before demo data replaces them. Throws if it cannot (then the demo
 *  must not be loaded: there would be no way back). */
export async function keepBeforeDemo(before: DataMap, counters?: Record<string, number>): Promise<void> {
  await setList(BEFORE_KEY(), before as unknown as Rec[]);
  localStorage.setItem(COUNTERS_KEY(), JSON.stringify(counters || {}));
}

/** The document counters from before the demo (so numbering carries on exactly where the business was). */
export function countersBeforeDemo(): Record<string, number> | undefined {
  try { const raw = localStorage.getItem(COUNTERS_KEY()); return raw ? JSON.parse(raw) as Record<string, number> : undefined; }
  catch { return undefined; }
}

export async function setDemoState(s: DemoState | null, before?: DataMap): Promise<void> {
  const key = BEFORE_KEY();
  try {
    if (!s) { localStorage.removeItem(FLAG_KEY()); localStorage.removeItem(COUNTERS_KEY()); await setList(key, null); }
    else {
      if (before) await setList(key, before as unknown as Rec[]);
      localStorage.setItem(FLAG_KEY(), JSON.stringify(s));
    }
  } catch { /* storage blocked: the demo still works; the safety copy made before loading can put things back */ }
  window.dispatchEvent(new Event(DEMO_EVENT));
}

export async function dataBeforeDemo(): Promise<DataMap | null> {
  try { return ((await getList(BEFORE_KEY())) as unknown as DataMap) || null; }
  catch { return null; }
}

const DAY = 86400000;
const DATE_START = /^(\d{4})-(\d{2})-(\d{2})(?=$|T)/;

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10))
    - Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10))) / DAY);
}

/** Moves a date ("2026-11-04", "2026-11-04T10:30", full ISO) by whole days, keeping its format and time of day. */
export function shiftDate(s: string, days: number): string {
  const m = DATE_START.exec(s);
  if (!m || !days) return s;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + days * DAY);
  return d.toISOString().slice(0, 10) + s.slice(10);
}

/**
 * The demo records as they should be stored today: every date moved forward by the same number of days
 * (so "overdue" and "due this week" still mean something), and the placeholder owner replaced by `ownerId`.
 */
export function prepareDemo(file: DemoFile, ownerId: string, today: string, userIds: Record<string, string> = {}): DataMap {
  if (file?.kind !== 'demo' || !file.data || typeof file.data !== 'object') throw new Error('The demo data file is damaged.');
  const days = daysBetween(file.generatedOn, today);
  const walk = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string') {
      if (v === file.ownerId) return ownerId;
      // Demo team members get ids of their own in each business (`userIds`: id in the file → id here).
      if (userIds[v]) return userIds[v];
      // File contents (data: URLs) are never touched.
      return key === 'dataUrl' ? v : shiftDate(v, days);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return renumberByYear(walk(file.data) as DataMap);
}

/**
 * Moving dates can carry a document into another financial year (across 1 April). Its number must then belong to
 * that year too (INV/26-27/… → INV/27-28/…), or the app would refuse to edit it. Numbers restart at 1 per year,
 * in date order, exactly as if the documents had been made on those dates.
 */
export function renumberByYear(data: DataMap): DataMap {
  const out: DataMap = { ...data };
  for (const e of ENTITIES) {
    if (!e.numberPrefix || !e.fyNumberField || !Array.isArray(out[e.key])) continue;
    const field = e.fyNumberField;
    const list = out[e.key].map((r) => ({ ...r }));
    const byYear = new Map<string, Rec[]>();
    for (const r of list) {
      if (!r.number) continue;
      const fy = financialYear(String(r[field] || r.createdAt || '').slice(0, 10));
      byYear.set(fy, [...(byYear.get(fy) || []), r]);
    }
    for (const [fy, recs] of byYear) {
      recs.sort((a, b) => String(a[field] || '').localeCompare(String(b[field] || '')) || (Number(a._seq) || 0) - (Number(b._seq) || 0));
      recs.forEach((r, i) => {
        r._numKey = `${e.key}:${fy}`;
        r._seq = i + 1;
        r.number = `${e.numberPrefix}/${fy}/${String(i + 1).padStart(4, '0')}`;
      });
    }
    out[e.key] = list;
  }
  return out;
}
