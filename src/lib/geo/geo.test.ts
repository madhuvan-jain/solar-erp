import { describe, expect, it } from 'vitest';
import { STATES } from '../states';
import {
  CITY_COORDS, PIN_PREFIX, STATE_CENTROIDS, STATE_SHAPES, VIEWBOX, inIndia, locate, project, stateFromPincode,
} from './indiaMap';

type Pt = [number, number];

/** Parses the generated paths (absolute M/L/Z commands) into rings. */
function parseRings(d: string): Pt[][] {
  const rings: Pt[][] = [];
  for (const sub of d.split('M').filter(Boolean)) {
    const ring = sub.replace(/Z$/, '').split('L').map((p) => p.split(',').map(Number) as Pt);
    rings.push(ring);
  }
  return rings;
}

/** Even-odd point-in-polygon over all subpaths (handles islands, enclaves and holes). */
function inPath(x: number, y: number, rings: Pt[][]): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const RINGS = new Map(STATE_SHAPES.map((s) => [s.name, parseRings(s.d)]));
const stateAt = (lat: number, lng: number) => {
  const [x, y] = project(lat, lng);
  return STATE_SHAPES.filter((s) => inPath(x, y, RINGS.get(s.name)!)).map((s) => s.name);
};

describe('india map shapes', () => {
  it('has exactly one well-formed shape and a centroid for every canonical state/UT', () => {
    for (const name of STATES) {
      expect(STATE_SHAPES.filter((s) => s.name === name), name).toHaveLength(1);
      expect(STATE_CENTROIDS[name], name).toBeDefined();
    }
    expect(STATE_SHAPES.map((s) => s.name).sort()).toEqual([...STATES].sort());
    expect(Object.keys(STATE_CENTROIDS).sort()).toEqual([...STATES].sort());
    for (const s of STATE_SHAPES) {
      expect(s.d, s.name).toMatch(/^M[\d.]+,[\d.]+(L[\d.]+,[\d.]+)+Z/);
      const rings = RINGS.get(s.name)!;
      expect(rings.length).toBeGreaterThan(0);
      for (const r of rings) for (const [x, y] of r) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(VIEWBOX.width);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(VIEWBOX.height);
      }
    }
  });

  it('keeps small UTs visible (non-empty, multi-point paths)', () => {
    for (const name of ['Chandigarh', 'Delhi', 'Puducherry', 'Lakshadweep', 'Dadra and Nagar Haveli and Daman and Diu']) {
      const rings = RINGS.get(name)!;
      expect(rings.some((r) => r.length >= 3), name).toBe(true);
    }
    expect(RINGS.get('Lakshadweep')!.length).toBeGreaterThan(5); // the islands are separate subpaths
  });

  it('puts label points and projected centroids inside their own state', () => {
    for (const s of STATE_SHAPES) {
      expect(inPath(s.cx, s.cy, RINGS.get(s.name)!), `label ${s.name}`).toBe(true);
      const [lat, lng] = STATE_CENTROIDS[s.name];
      expect(inIndia(lat, lng)).toBe(true);
      expect(stateAt(lat, lng), `centroid ${s.name}`).toEqual([s.name]);
    }
  });

  it.each([
    ['delhi', 'Delhi'], ['mumbai', 'Maharashtra'], ['chennai', 'Tamil Nadu'], ['kolkata', 'West Bengal'],
    ['bengaluru', 'Karnataka'], ['jaipur', 'Rajasthan'], ['lucknow', 'Uttar Pradesh'], ['patna', 'Bihar'],
    ['guwahati', 'Assam'], ['srinagar', 'Jammu and Kashmir'], ['leh', 'Ladakh'], ['thiruvananthapuram', 'Kerala'],
    ['port blair', 'Andaman and Nicobar Islands'], ['ahmedabad', 'Gujarat'], ['bhopal', 'Madhya Pradesh'],
    ['chandigarh', 'Chandigarh'], ['puducherry', 'Puducherry'], ['silvassa', 'Dadra and Nagar Haveli and Daman and Diu'],
    ['hyderabad', 'Telangana'], ['vijayawada', 'Andhra Pradesh'],
  ])('projects %s inside %s', (city, state) => {
    const c = CITY_COORDS[city];
    expect(c, city).toBeDefined();
    expect(stateAt(c[0], c[1])).toEqual([state]);
  });

  it('project is a linear lat/lng -> viewBox mapping (north up, east right)', () => {
    const [x1, y1] = project(20, 80);
    const [x2, y2] = project(21, 81);
    expect(x2).toBeGreaterThan(x1);
    expect(y2).toBeLessThan(y1);
    expect(project(50, 120).every(Number.isFinite)).toBe(true); // out-of-range input still returns numbers
    expect(inIndia(50, 120)).toBe(false);
    expect(inIndia(28.6, 77.2)).toBe(true);
  });
});

describe('city and PIN tables', () => {
  it('covers capitals and alias spellings', () => {
    expect(Object.keys(CITY_COORDS).length).toBeGreaterThan(250);
    for (const k of Object.keys(CITY_COORDS)) expect(k).toBe(k.toLowerCase());
    const aliases: [string, string][] = [
      ['bangalore', 'bengaluru'], ['gurgaon', 'gurugram'], ['bombay', 'mumbai'], ['calcutta', 'kolkata'],
      ['madras', 'chennai'], ['poona', 'pune'], ['trivandrum', 'thiruvananthapuram'], ['baroda', 'vadodara'],
      ['mysore', 'mysuru'], ['vizag', 'visakhapatnam'], ['allahabad', 'prayagraj'],
    ];
    for (const [a, b] of aliases) expect(CITY_COORDS[a], a).toEqual(CITY_COORDS[b]);
    for (const c of ['kavaratti', 'port blair', 'itanagar', 'gangtok', 'kohima', 'aizawl', 'imphal', 'shillong', 'agartala', 'dispur', 'panaji', 'shimla', 'dehradun', 'raipur', 'ranchi', 'gandhinagar', 'amaravati', 'daman', 'leh']) {
      expect(CITY_COORDS[c], c).toBeDefined();
    }
  });

  it('maps PIN prefixes to canonical states with coordinates inside India', () => {
    expect(Object.keys(PIN_PREFIX).length).toBeGreaterThan(400);
    for (const [k, v] of Object.entries(PIN_PREFIX)) {
      expect(k).toMatch(/^[1-9]\d\d$/);
      expect(STATES).toContain(v.state);
      expect(inIndia(v.lat, v.lng)).toBe(true);
    }
  });

  it('stateFromPincode', () => {
    expect(stateFromPincode('110001')).toBe('Delhi');
    expect(stateFromPincode('400001')).toBe('Maharashtra');
    expect(stateFromPincode('560001')).toBe('Karnataka');
    expect(stateFromPincode('700001')).toBe('West Bengal');
    expect(stateFromPincode('600001')).toBe('Tamil Nadu');
    expect(stateFromPincode('302001')).toBe('Rajasthan');
    expect(stateFromPincode(' 110 001 ')).toBe('Delhi');
    expect(stateFromPincode(110001)).toBe('Delhi');
    expect(stateFromPincode('11000')).toBeUndefined();
    expect(stateFromPincode('1100011')).toBeUndefined();
    expect(stateFromPincode('011001')).toBeUndefined();
    expect(stateFromPincode('abcdef')).toBeUndefined();
    expect(stateFromPincode(undefined)).toBeUndefined();
    expect(stateFromPincode(null)).toBeUndefined();
  });
});

describe('locate', () => {
  it('prefers exact coordinates inside India, numbers or numeric strings', () => {
    expect(locate({ lat: 26.9, lng: 75.8, pincode: '110001', city: 'mumbai', state: 'Kerala' }))
      .toEqual({ lat: 26.9, lng: 75.8, precision: 'exact' });
    expect(locate({ lat: ' 19.07 ', lng: '72.88' })).toEqual({ lat: 19.07, lng: 72.88, precision: 'exact' });
  });

  it('ignores bad or out-of-India coordinates and falls through', () => {
    expect(locate({ lat: 'abc', lng: '77', pincode: '110001' })?.precision).toBe('pincode');
    expect(locate({ lat: '', lng: '', pincode: '110001' })?.precision).toBe('pincode');
    expect(locate({ lat: null, lng: null, city: 'jaipur' })?.precision).toBe('city');
    expect(locate({ lat: NaN, lng: 77, city: 'jaipur' })?.precision).toBe('city');
    expect(locate({ lat: 0, lng: 0, city: 'jaipur' })?.precision).toBe('city');
    expect(locate({ lat: 51.5, lng: -0.12, state: 'Goa' })?.precision).toBe('state');
    expect(locate({ lat: 28.6, city: 'jaipur' })?.precision).toBe('city'); // lng missing
  });

  it('uses the PIN prefix before city and state', () => {
    const r = locate({ pincode: '400001', city: 'Delhi', state: 'Delhi' });
    expect(r?.precision).toBe('pincode');
    expect(stateAt(r!.lat, r!.lng)).toEqual(['Maharashtra']);
    expect(locate({ pincode: 560001 })?.precision).toBe('pincode');
  });

  it('skips invalid PIN codes', () => {
    expect(locate({ pincode: '40000', city: 'pune' })?.precision).toBe('city'); // 5 digits
    expect(locate({ pincode: '000001', state: 'Goa' })?.precision).toBe('state');
  });

  it('matches cities case-insensitively, with aliases and suffixes', () => {
    expect(locate({ city: '  Bangalore ' })).toEqual({ lat: CITY_COORDS.bengaluru[0], lng: CITY_COORDS.bengaluru[1], precision: 'city' });
    expect(locate({ city: 'GURGAON' })?.precision).toBe('city');
    expect(locate({ city: 'Pune City' })).toMatchObject({ lat: CITY_COORDS.pune[0], precision: 'city' });
    expect(locate({ city: 'Nagpur District' })).toMatchObject({ lat: CITY_COORDS.nagpur[0], precision: 'city' });
    expect(locate({ city: 'Jaipur, Rajasthan' })).toMatchObject({ lat: CITY_COORDS.jaipur[0], precision: 'city' });
  });

  it('falls back to the state centroid (case-insensitive), then null', () => {
    expect(locate({ city: 'Nowhereville', state: 'tamil NADU' }))
      .toEqual({ lat: STATE_CENTROIDS['Tamil Nadu'][0], lng: STATE_CENTROIDS['Tamil Nadu'][1], precision: 'state' });
    expect(locate({ state: ' west bengal ' })?.precision).toBe('state');
    expect(locate({ state: 'Orissa' })).toMatchObject({ lat: STATE_CENTROIDS.Odisha[0], precision: 'state' });
    expect(locate({ city: 'Nowhereville' })).toBeNull();
    expect(locate({ state: 'Atlantis' })).toBeNull();
    expect(locate({})).toBeNull();
    expect(locate({ pincode: '', city: '', state: '', lat: '', lng: '' })).toBeNull();
  });
});
