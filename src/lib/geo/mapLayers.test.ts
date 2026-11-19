import { describe, expect, it } from 'vitest';
import { STATES } from '../states';
import { STATE_SHAPES, project } from './indiaMap';
import {
  DISTRICT_POINTS, PX_CITY, PX_RECORD, REF_CITIES, cityBubbles, fitBox, levelFor, nearestCity, placeLabels, placePoints, recordBubbles,
  spreadApart, stateAtXY, stateBounds, stateBubbles, type MapPoint,
} from './mapLayers';

const pt = (lat: number, lng: number, label: string, extra: Partial<MapPoint> = {}): MapPoint => ({ lat, lng, label, to: `/x/${label}`, ...extra });

describe('map layers', () => {
  it('every reference city is found, inside India, and inside a state', () => {
    expect(REF_CITIES.length).toBeGreaterThan(120);
    for (const c of REF_CITIES) expect(stateAtXY(c.x, c.y), c.name).toBeTruthy();
    const at = (name: string) => { const c = REF_CITIES.find((r) => r.name === name)!; return stateAtXY(c.x, c.y); };
    expect(at('Patna')).toBe('Bihar');
    expect(at('Jaipur')).toBe('Rajasthan');
    expect(at('Mumbai')).toBe('Maharashtra');
    expect(at('Bengaluru')).toBe('Karnataka');
    expect(at('Delhi')).toBe('Delhi');
  });

  it('every state has a box around its own label point', () => {
    for (const s of STATE_SHAPES) {
      const b = stateBounds(s.name)!;
      expect(STATES).toContain(s.name);
      expect(s.cx).toBeGreaterThanOrEqual(b.x);
      expect(s.cx).toBeLessThanOrEqual(b.x + b.w);
      expect(s.cy).toBeGreaterThanOrEqual(b.y);
      expect(s.cy).toBeLessThanOrEqual(b.y + b.h);
    }
  });

  it('names the nearest city, but not one far away', () => {
    expect(nearestCity(25.6, 85.13)).toBe('Patna');
    expect(nearestCity(19.07, 72.88)).toBe('Mumbai'); // the listed name wins over the alias "Bombay"
    expect(nearestCity(8.0, 70.0)).toBeUndefined(); // open sea
  });

  it('settles state and city: typed values first, otherwise from the map', () => {
    const [a, b, c] = placePoints([
      pt(25.61, 85.14, 'gps only'),
      pt(26.91, 75.79, 'typed', { state: 'Rajasthan', city: '  jaipur  ' }),
      pt(60, 10, 'abroad'),
    ]);
    expect(a).toMatchObject({ state: 'Bihar', city: 'Patna' });
    expect(b).toMatchObject({ state: 'Rajasthan', city: 'Jaipur' });
    expect(c).toBeUndefined(); // outside India is not drawn
  });

  it('picks the level from how far the map is zoomed', () => {
    expect(levelFor(2.7, false)).toBe('state');
    expect(levelFor(2.7, true)).toBe('city'); // a chosen state always shows its cities
    expect(levelFor(PX_CITY, false)).toBe('city');
    expect(levelFor(PX_RECORD, false)).toBe('record');
  });

  const sample = placePoints([
    ...Array.from({ length: 5 }, (_, i) => pt(25.6, 85.13, `Patna ${i}`, { city: 'Patna' })),
    pt(24.79, 85.0, 'Gaya 1', { city: 'Gaya' }),
    pt(26.91, 75.79, 'Jaipur 1', { city: 'Jaipur' }),
    pt(26.92, 75.8, 'Jaipur 2', { city: 'jaipur' }),
  ]);

  it('state level: one bubble per state, counts add up', () => {
    const bs = stateBubbles(sample);
    expect(bs.map((b) => [b.name, b.items.length])).toEqual([['Bihar', 6], ['Rajasthan', 2]]);
    expect(bs.reduce((s, b) => s + b.items.length, 0)).toBe(sample.length);
  });

  it('city level: one bubble per city (any spelling), close cities share one', () => {
    const near = cityBubbles(sample, 0.3);
    expect(near.map((b) => [b.name, b.items.length])).toEqual([['Patna', 5], ['Jaipur', 2], ['Gaya', 1]]);
    const far = cityBubbles(sample, 3); // zoomed far out: Patna and Gaya are 30 px apart at most
    expect(far.find((b) => b.name === 'Patna')!.items.length).toBe(6);
    expect(far.find((b) => b.name === 'Patna')!.more).toBe(1);
  });

  it('record level: records on the same spot are fanned out, each at its own place, linked to the real spot', () => {
    const bs = recordBubbles(sample, 0.05);
    expect(bs).toHaveLength(sample.length);
    const patna = bs.filter((b) => b.name.startsWith('Patna'));
    const spots = new Set(patna.map((b) => `${b.x.toFixed(2)},${b.y.toFixed(2)}`));
    expect(spots.size).toBe(5);
    const [x, y] = project(25.6, 85.13);
    for (const b of patna) expect(b.anchor).toEqual({ x, y });
    for (let i = 0; i < patna.length; i++) for (let j = i + 1; j < patna.length; j++) {
      expect(Math.hypot(patna[i].x - patna[j].x, patna[i].y - patna[j].y)).toBeGreaterThan(0.05 * 8); // ≥ 8 px apart
    }
  });

  it('overlapping state bubbles are pushed apart', () => {
    const bs = stateBubbles(placePoints([pt(28.61, 77.21, 'Delhi', { state: 'Delhi' }), pt(28.6, 77.0, 'Haryana', { state: 'Haryana' })]));
    const out = spreadApart(bs, () => 30, 3);
    expect(Math.hypot(out[0].x - out[1].x, out[0].y - out[1].y)).toBeGreaterThanOrEqual(62.9);
  });

  it('labels never overlap each other or a marker, and stay in view', () => {
    const view = { x: 0, y: 0, w: 1000, h: 1160 };
    const cands = REF_CITIES.map((c) => ({ x: c.x, y: c.y, text: c.name, size: 11, priority: c.tier, gap: 4 }));
    const marker = { x: REF_CITIES[0].x, y: REF_CITIES[0].y, r: 20 };
    const placed = placeLabels(cands, 2.7, view, [marker]);
    expect(placed.length).toBeGreaterThan(5);
    const box = (l: (typeof placed)[0]) => {
      const w = l.text.length * l.size * 0.58 * 2.7, h = l.size * 1.2 * 2.7;
      const x0 = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2;
      return { x0, y0: l.y - h / 2, x1: x0 + w, y1: l.y + h / 2 };
    };
    for (let i = 0; i < placed.length; i++) {
      const a = box(placed[i]);
      expect(a.x0).toBeGreaterThanOrEqual(0);
      expect(a.x1).toBeLessThanOrEqual(1000);
      expect(a.x1 <= marker.x - marker.r || a.x0 >= marker.x + marker.r || a.y1 <= marker.y - marker.r || a.y0 >= marker.y + marker.r).toBe(true);
      for (let j = i + 1; j < placed.length; j++) {
        const b = box(placed[j]);
        expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true);
      }
    }
  });

  it('fitBox keeps every point inside, with the asked shape', () => {
    const pts = [{ x: 100, y: 100 }, { x: 300, y: 180 }];
    const b = fitBox(pts, 0.5, 10);
    expect(b.h / b.w).toBeCloseTo(0.5);
    for (const p of pts) { expect(p.x).toBeGreaterThan(b.x); expect(p.x).toBeLessThan(b.x + b.w); expect(p.y).toBeGreaterThan(b.y); expect(p.y).toBeLessThan(b.y + b.h); }
    expect(fitBox([{ x: 5, y: 5 }], 1, 40).w).toBe(40); // a single point does not zoom in without limit
  });

  it('every district of India is on the map, inside its own state, with the app\'s state names', () => {
    expect(DISTRICT_POINTS.length).toBeGreaterThan(740);
    const of = (st: string) => DISTRICT_POINTS.filter((d) => d.state === st).length;
    expect(of('Bihar')).toBe(38);
    expect(of('Uttar Pradesh')).toBe(75);
    for (const d of DISTRICT_POINTS) expect(STATES).toContain(d.state);
    const outside = DISTRICT_POINTS.filter((d) => stateAtXY(d.x, d.y) !== d.state);
    expect(outside.length).toBeLessThanOrEqual(5); // tiny islands and enclaves only
    expect(DISTRICT_POINTS.some((d) => /^district\b|\bdistrict$/i.test(d.name))).toBe(false);
  });

  it('district names may step up or down a line to fit beside each other', () => {
    const view = { x: 0, y: 0, w: 1000, h: 1000 };
    const placed = placeLabels([
      { x: 500, y: 500, text: 'Patna', size: 10, priority: 1, kind: 'district' },
      { x: 505, y: 500, text: 'Nalanda', size: 10, priority: 2, kind: 'district' },
    ], 1, view);
    expect(placed).toHaveLength(2);
    expect(placed[1].y).not.toBe(500);
  });
});
