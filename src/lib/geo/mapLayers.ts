// What the India map draws at each zoom level: one bubble per state, then per city, then every record.
// Pure functions over VIEWBOX units, so they can be tested without a browser.
import { CITY_COORDS, STATE_SHAPES, inIndia, project } from './indiaMap';
import { DISTRICTS } from './districts';
import { canonicalState } from '../states';

/** Every district (GeoNames), at its label point, with the state named the way the app names states. */
export interface District { name: string; state: string; x: number; y: number }
export const DISTRICT_POINTS: District[] = DISTRICTS.map(([name, st, lat, lng]) => {
  const [x, y] = project(lat, lng);
  return { name, state: canonicalState(st) || (st === 'Andaman and Nicobar' ? 'Andaman and Nicobar Islands' : st), x, y };
});

export interface MapPoint { lat: number; lng: number; label: string; to?: string; state?: string; city?: string }
export interface PlacedPoint extends MapPoint { x: number; y: number; state?: string; city: string }
export interface Box { x: number; y: number; w: number; h: number }

/** Reference cities: tier 1 shows on the whole-India view, tier 2 from 2× zoom, tier 3 from 3.5×. */
const CITY_LIST: [display: string, key: string, tier: 1 | 2 | 3][] = [
  ['Delhi', 'new delhi', 1], ['Mumbai', 'mumbai', 1], ['Kolkata', 'kolkata', 1], ['Chennai', 'chennai', 1],
  ['Bengaluru', 'bengaluru', 1], ['Hyderabad', 'hyderabad', 1], ['Ahmedabad', 'ahmedabad', 1], ['Pune', 'pune', 1],
  ['Jaipur', 'jaipur', 1], ['Lucknow', 'lucknow', 1], ['Patna', 'patna', 1], ['Bhopal', 'bhopal', 1],
  ['Guwahati', 'guwahati', 1], ['Bhubaneswar', 'bhubaneswar', 1], ['Srinagar', 'srinagar', 1], ['Thiruvananthapuram', 'thiruvananthapuram', 1],
  ['Chandigarh', 'chandigarh', 2], ['Shimla', 'shimla', 2], ['Dehradun', 'dehradun', 2], ['Ranchi', 'ranchi', 2],
  ['Raipur', 'raipur', 2], ['Gandhinagar', 'gandhinagar', 2], ['Kochi', 'kochi', 2], ['Panaji', 'panaji', 2],
  ['Shillong', 'shillong', 2], ['Imphal', 'imphal', 2], ['Aizawl', 'aizawl', 2], ['Kohima', 'kohima', 2],
  ['Agartala', 'agartala', 2], ['Itanagar', 'itanagar', 2], ['Gangtok', 'gangtok', 2], ['Sri Vijaya Puram', 'sri vijaya puram', 2],
  ['Puducherry', 'puducherry', 2], ['Amaravati', 'amaravati', 2], ['Visakhapatnam', 'visakhapatnam', 2], ['Vijayawada', 'vijayawada', 2],
  ['Nagpur', 'nagpur', 2], ['Indore', 'indore', 2], ['Surat', 'surat', 2], ['Vadodara', 'vadodara', 2],
  ['Rajkot', 'rajkot', 2], ['Kanpur', 'kanpur', 2], ['Varanasi', 'varanasi', 2], ['Agra', 'agra', 2],
  ['Prayagraj', 'prayagraj', 2], ['Coimbatore', 'coimbatore', 2], ['Madurai', 'madurai', 2], ['Mysuru', 'mysuru', 2],
  ['Mangaluru', 'mangaluru', 2], ['Ludhiana', 'ludhiana', 2], ['Amritsar', 'amritsar', 2], ['Jodhpur', 'jodhpur', 2],
  ['Udaipur', 'udaipur', 2], ['Kota', 'kota', 2], ['Bikaner', 'bikaner', 2], ['Jammu', 'jammu', 2], ['Leh', 'leh', 2],
  ['Siliguri', 'siliguri', 2], ['Jamshedpur', 'jamshedpur', 2], ['Gwalior', 'gwalior', 2], ['Jabalpur', 'jabalpur', 2],
  ['Nashik', 'nashik', 2], ['Kozhikode', 'kozhikode', 2], ['Gaya', 'gaya', 2], ['Muzaffarpur', 'muzaffarpur', 2],
  ['Gorakhpur', 'gorakhpur', 2], ['Meerut', 'meerut', 2], ['Cuttack', 'cuttack', 2], ['Dibrugarh', 'dibrugarh', 2],
  ['Chh. Sambhajinagar', 'chhatrapati sambhajinagar', 3], ['Tiruchirappalli', 'tiruchirappalli', 3], ['Hubballi', 'hubballi', 3],
  ['Belagavi', 'belagavi', 3], ['Bhagalpur', 'bhagalpur', 3], ['Darbhanga', 'darbhanga', 3], ['Purnia', 'purnia', 3],
  ['Bareilly', 'bareilly', 3], ['Noida', 'noida', 3], ['Gurugram', 'gurugram', 3], ['Faridabad', 'faridabad', 3],
  ['Ghaziabad', 'ghaziabad', 3], ['Rourkela', 'rourkela', 3], ['Sambalpur', 'sambalpur', 3], ['Puri', 'puri', 3],
  ['Bilaspur', 'bilaspur', 3], ['Kolhapur', 'kolhapur', 3], ['Solapur', 'solapur', 3], ['Jalandhar', 'jalandhar', 3],
  ['Jhansi', 'jhansi', 3], ['Ujjain', 'ujjain', 3], ['Tirupati', 'tirupati', 3], ['Warangal', 'warangal', 3],
  ['Nellore', 'nellore', 3], ['Kurnool', 'kurnool', 3], ['Salem', 'salem', 3], ['Tirunelveli', 'tirunelveli', 3],
  ['Silchar', 'silchar', 3], ['Jorhat', 'jorhat', 3], ['Haridwar', 'haridwar', 3], ['Ajmer', 'ajmer', 3],
  ['Bhavnagar', 'bhavnagar', 3], ['Jamnagar', 'jamnagar', 3], ['Kakinada', 'kakinada', 3], ['Asansol', 'asansol', 3],
  ['Durgapur', 'durgapur', 3], ['Dhanbad', 'dhanbad', 3], ['Bokaro', 'bokaro', 3], ['Hisar', 'hisar', 3],
  ['Panipat', 'panipat', 3], ['Bathinda', 'bathinda', 3], ['Aligarh', 'aligarh', 3], ['Ayodhya', 'ayodhya', 3],
  ['Thrissur', 'thrissur', 3], ['Kannur', 'kannur', 3], ['Vellore', 'vellore', 3], ['Thanjavur', 'thanjavur', 3],
  ['Davanagere', 'davanagere', 3], ['Kalaburagi', 'kalaburagi', 3], ['Nanded', 'nanded', 3], ['Amravati', 'amravati', 3],
  ['Akola', 'akola', 3], ['Jalgaon', 'jalgaon', 3], ['Sagar', 'sagar', 3], ['Rewa', 'rewa', 3], ['Satna', 'satna', 3],
  ['Korba', 'korba', 3], ['Jagdalpur', 'jagdalpur', 3], ['Bhuj', 'bhuj', 3], ['Jaisalmer', 'jaisalmer', 3],
  ['Haldwani', 'haldwani', 3], ['Dimapur', 'dimapur', 3], ['Tezpur', 'tezpur', 3], ['Daman', 'daman', 3],
];

export interface RefCity { name: string; x: number; y: number; tier: 1 | 2 | 3 }

export const REF_CITIES: RefCity[] = CITY_LIST.flatMap(([name, key, tier]) => {
  const c = CITY_COORDS[key];
  if (!c) return [];
  const [x, y] = project(c[0], c[1]);
  return [{ name, x, y, tier }];
});

const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** One name per place (aliases such as Bombay/Mumbai share coordinates; the listed name wins). */
const NAMED_PLACES: { name: string; lat: number; lng: number }[] = (() => {
  const preferred = new Map(CITY_LIST.map(([name, key]) => [key, name]));
  const byCoord = new Map<string, { name: string; lat: number; lng: number; rank: number }>();
  for (const [key, [lat, lng]] of Object.entries(CITY_COORDS)) {
    const k = `${lat},${lng}`;
    const rank = preferred.has(key) ? 0 : 1;
    const cur = byCoord.get(k);
    if (!cur || rank < cur.rank) byCoord.set(k, { name: preferred.get(key) || titleCase(key), lat, lng, rank });
  }
  return [...byCoord.values()];
})();

/** Name of the closest known city within about 45 km, for records that have a PIN code or GPS but no city typed. */
export function nearestCity(lat: number, lng: number, maxKm = 45): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  const cos = Math.cos((lat * Math.PI) / 180);
  for (const p of NAMED_PLACES) {
    const dx = (p.lng - lng) * cos, dy = p.lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = p.name; }
  }
  return Math.sqrt(bestD) * 111 <= maxKm ? best : undefined;
}

// ---- State shapes as polygons: which state a point is in, and each state's bounding box ----
type Ring = [number, number][];
let rings: Map<string, Ring[]> | null = null;
function stateRings(): Map<string, Ring[]> {
  if (!rings) {
    rings = new Map(STATE_SHAPES.map((s) => [s.name, s.d.split('M').filter(Boolean)
      .map((sub) => sub.replace(/Z$/, '').split('L').map((p) => p.split(',').map(Number) as [number, number]))]));
  }
  return rings;
}

function inRings(x: number, y: number, rs: Ring[]): boolean {
  let inside = false;
  for (const r of rs) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The state or UT drawn under a map position (VIEWBOX units). */
export function stateAtXY(x: number, y: number): string | undefined {
  for (const [name, rs] of stateRings()) if (inRings(x, y, rs)) return name;
  return undefined;
}

const boundsCache = new Map<string, Box>();
/** Bounding box of a state's shape, in VIEWBOX units. */
export function stateBounds(name: string): Box | undefined {
  if (boundsCache.has(name)) return boundsCache.get(name);
  const rs = stateRings().get(name);
  if (!rs) return undefined;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  boundsCache.set(name, b);
  return b;
}

/** Projects records onto the map and settles each one's state and city name. Records outside India are dropped. */
export function placePoints(points: MapPoint[]): PlacedPoint[] {
  const out: PlacedPoint[] = [];
  for (const p of points) {
    if (!inIndia(p.lat, p.lng)) continue;
    const [x, y] = project(p.lat, p.lng);
    const state = p.state || stateAtXY(x, y);
    const typed = typeof p.city === 'string' ? p.city.trim().replace(/\s+/g, ' ') : '';
    const city = typed ? titleCase(typed.toLowerCase()) : nearestCity(p.lat, p.lng) || (state ? `Elsewhere in ${state}` : 'Unknown place');
    out.push({ ...p, x, y, state, city });
  }
  return out;
}

export type Level = 'state' | 'city' | 'record';

/** One map unit is about 3 km; these are map units per screen pixel. */
export const PX_CITY = 1.5; // closer than ~4.5 km per pixel: cities
export const PX_RECORD = 0.14; // closer than ~400 m per pixel: every record
export const PX_MIN = 0.03; // closest zoom, ~100 m per pixel

/** Whole India: states. A region or one chosen state: cities. Close up: every record. */
export function levelFor(px: number, stateChosen: boolean): Level {
  if (px <= PX_RECORD) return 'record';
  if (px <= PX_CITY || stateChosen) return 'city';
  return 'state';
}

export interface Bubble {
  key: string;
  kind: Level;
  x: number;
  y: number;
  items: PlacedPoint[];
  /** state name, city name, or record label */
  name: string;
  /** other cities folded into this bubble because they were too close to draw apart */
  more?: number;
  /** where a record really is, when it had to be moved aside so overlapping records can each be clicked */
  anchor?: { x: number; y: number };
}

export function stateBubbles(points: PlacedPoint[]): Bubble[] {
  const groups = new Map<string, PlacedPoint[]>();
  for (const p of points) {
    const k = p.state || '';
    groups.set(k, [...(groups.get(k) || []), p]);
  }
  const out: Bubble[] = [];
  for (const [state, items] of groups) {
    const shape = state ? STATE_SHAPES.find((s) => s.name === state) : undefined;
    if (shape) out.push({ key: 's:' + state, kind: 'state', x: shape.cx, y: shape.cy, items, name: state });
    else for (const b of cityBubbles(items, 1)) out.push(b); // somewhere we cannot name a state for
  }
  return out.sort((a, b) => b.items.length - a.items.length);
}

/** One bubble per city; cities closer than `gapPx` on screen share a bubble named after the bigger one. */
export function cityBubbles(points: PlacedPoint[], px: number, gapPx = 26): Bubble[] {
  const groups = new Map<string, PlacedPoint[]>();
  for (const p of points) {
    const k = `${p.state || ''}|${p.city.toLowerCase()}`;
    groups.set(k, [...(groups.get(k) || []), p]);
  }
  const raw = [...groups.entries()].map(([k, items]) => ({
    key: 'c:' + k, kind: 'city' as const, items, name: items[0].city,
    x: items.reduce((s, p) => s + p.x, 0) / items.length, y: items.reduce((s, p) => s + p.y, 0) / items.length,
  })).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  const out: Bubble[] = [];
  const gap = gapPx * px;
  for (const b of raw) {
    const host = out.find((o) => Math.hypot(o.x - b.x, o.y - b.y) < gap);
    if (host) { host.items = host.items.concat(b.items); host.more = (host.more || 0) + 1; }
    else out.push({ ...b });
  }
  return out;
}

/** Every record; records on the same spot fan out in a small spiral so each one can be clicked. */
export function recordBubbles(points: PlacedPoint[], px: number): Bubble[] {
  const stacks = new Map<string, PlacedPoint[]>();
  const cell = 3 * px;
  for (const p of points) {
    const k = `${Math.round(p.x / cell)}:${Math.round(p.y / cell)}`;
    stacks.set(k, [...(stacks.get(k) || []), p]);
  }
  const out: Bubble[] = [];
  for (const items of stacks.values()) {
    const ax = items[0].x, ay = items[0].y;
    items.forEach((p, i) => {
      const spread = items.length > 1;
      const r = spread ? 9 * px * Math.sqrt(i + 0.6) : 0;
      const a = i * 2.39996; // golden angle
      out.push({
        key: 'r:' + (p.to || `${p.label}:${p.x}:${p.y}:${i}`), kind: 'record', items: [p], name: p.label,
        x: ax + r * Math.cos(a), y: ay + r * Math.sin(a), anchor: spread ? { x: ax, y: ay } : undefined,
      });
    });
  }
  return out;
}

/**
 * Pushes overlapping markers apart (sizes in map units) so each can be seen and clicked;
 * a moved marker keeps a line back to where it belongs.
 */
export function spreadApart(bubbles: Bubble[], radiusOf: (b: Bubble) => number, gap: number): Bubble[] {
  const out = bubbles.map((b) => ({ ...b, ox: b.x, oy: b.y }));
  for (let round = 0; round < 40; round++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const need = radiusOf(a) + radiusOf(b) + gap;
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= need) continue;
        if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
        // The smaller marker moves more, so big states stay where they are.
        const wa = radiusOf(b) / (radiusOf(a) + radiusOf(b)), push = need - d;
        a.x -= (dx / d) * push * wa; a.y -= (dy / d) * push * wa;
        b.x += (dx / d) * push * (1 - wa); b.y += (dy / d) * push * (1 - wa);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out.map(({ ox, oy, ...b }) => (Math.hypot(b.x - ox, b.y - oy) > radiusOf(b) * 0.5 ? { ...b, anchor: { x: ox, y: oy } } : b));
}

/** Smallest box around these points, padded, never narrower than `minW` (so one point does not zoom in to street level). */
export function fitBox(pts: { x: number; y: number }[], aspect: number, minW: number, pad = 0.15): Box {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let w = Math.max(minW, (x1 - x0) * (1 + 2 * pad));
  let h = Math.max((y1 - y0) * (1 + 2 * pad), w * aspect);
  w = Math.max(w, h / aspect);
  h = w * aspect;
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}

export interface Label {
  x: number;
  y: number;
  text: string;
  /** font size, screen pixels */
  size: number;
  /** lower is placed first */
  priority: number;
  /** distance from the point to the text, screen pixels; leave out to centre the text on the point */
  gap?: number;
  /** how it is drawn: a marker's own name, a reference city, a district or a state name */
  kind?: 'hit' | 'place' | 'district' | 'state';
}
export interface PlacedLabel extends Label { anchor: 'start' | 'end' | 'middle' }

/**
 * Keeps the labels that fit, most important first: each tries right, left, above and below its point and is
 * dropped if all four overlap a label already placed or a marker (`avoid`, circles in map units).
 */
export function placeLabels(cands: Label[], px: number, view: Box, avoid: { x: number; y: number; r: number }[] = []): PlacedLabel[] {
  type R = { x0: number; y0: number; x1: number; y1: number };
  const taken: R[] = avoid.map((c) => ({ x0: c.x - c.r, y0: c.y - c.r, x1: c.x + c.r, y1: c.y + c.r }));
  const hits = (b: R) => taken.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
  const out: PlacedLabel[] = [];
  for (const l of [...cands].sort((a, b) => a.priority - b.priority)) {
    const w = l.text.length * l.size * 0.58 * px, h = l.size * 1.2 * px, m = 2 * px;
    const g = l.gap === undefined ? undefined : l.gap * px;
    const centred = (dy: number) => ({ anchor: 'middle' as const, x: l.x, y: l.y + dy, box: { x0: l.x - w / 2, y0: l.y + dy - h / 2, x1: l.x + w / 2, y1: l.y + dy + h / 2 } });
    // District names sit on the district; if that spot is taken they may move up or down by a line.
    const tries: { anchor: PlacedLabel['anchor']; x: number; y: number; box: R }[] = g === undefined
      ? (l.kind === 'district' ? [centred(0), centred(-(h + 2 * m + 0.5 * px)), centred(h + 2 * m + 0.5 * px)] : [centred(0)])
      : [
        { anchor: 'start', x: l.x + g, y: l.y, box: { x0: l.x + g, y0: l.y - h / 2, x1: l.x + g + w, y1: l.y + h / 2 } },
        { anchor: 'end', x: l.x - g, y: l.y, box: { x0: l.x - g - w, y0: l.y - h / 2, x1: l.x - g, y1: l.y + h / 2 } },
        { anchor: 'middle', x: l.x, y: l.y - g - h / 2, box: { x0: l.x - w / 2, y0: l.y - g - h, x1: l.x + w / 2, y1: l.y - g } },
        { anchor: 'middle', x: l.x, y: l.y + g + h / 2, box: { x0: l.x - w / 2, y0: l.y + g, x1: l.x + w / 2, y1: l.y + g + h } },
      ];
    for (const t of tries) {
      const b = { x0: t.box.x0 - m, y0: t.box.y0 - m, x1: t.box.x1 + m, y1: t.box.y1 + m };
      if (b.x0 < view.x || b.x1 > view.x + view.w || b.y0 < view.y || b.y1 > view.y + view.h) continue;
      if (hits(b)) continue;
      taken.push(b);
      out.push({ ...l, x: t.x, y: t.y, anchor: t.anchor });
      break;
    }
  }
  return out;
}
