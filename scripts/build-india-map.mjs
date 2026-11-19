// Generates src/lib/geo/indiaMap.ts (offline India map data) from public source files.
// Plain Node ESM, no project dependencies. See docs/third-party/map-data-sources.md.
//
// Usage:
//   node scripts/build-india-map.mjs \
//     --states <Admin2.shp | simplified-states.geojson> \
//     --pins   <pincode.csv> \
//     --cities <cities1000.txt> \
//     [--out src/lib/geo/indiaMap.ts] [--interval 1200] [--mapshaper <path to mapshaper bin>]
//
// --states  DataMeet "States/Admin2" shapefile (needs the .dbf/.shx next to it). When a .shp is
//           given it is simplified with mapshaper (run through `npx mapshaper@0.6.121` unless
//           --mapshaper points at a local binary). A .geojson/.json is used as-is.
// --pins    All India Pincode Directory CSV (data.gov.in columns incl. Pincode, StateName,
//           Latitude, Longitude).
// --cities  GeoNames cities1000.txt (or an India-only extract of it), tab separated.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------- CLI
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i];
  if (!k.startsWith('--') || process.argv[i + 1] === undefined) usage(`Bad argument: ${k}`);
  args[k.slice(2)] = process.argv[i + 1];
}
function usage(msg) {
  console.error(msg + '\nUsage: node scripts/build-india-map.mjs --states <Admin2.shp|geojson> --pins <pincode.csv> --cities <cities1000.txt> [--out <file>] [--interval <metres>] [--mapshaper <bin>]');
  process.exit(1);
}
if (!args.states || !args.pins || !args.cities) usage('Missing required arguments.');
const OUT = args.out || 'src/lib/geo/indiaMap.ts';
const INTERVAL = Number(args.interval || 1200); // mapshaper simplification interval in metres

// ---------------------------------------------------------------- canonical names
const statesSrc = readFileSync(new URL('../src/lib/states.ts', import.meta.url), 'utf8');
const STATES = [...statesSrc.matchAll(/'\d\d':\s*'([^']+)'/g)].map((m) => m[1]).sort();
if (STATES.length < 30) throw new Error('Could not read STATE_CODES from src/lib/states.ts');
const STATE_ALIASES = {
  'andaman & nicobar': 'Andaman and Nicobar Islands',
  'andaman & nicobar islands': 'Andaman and Nicobar Islands',
  'andaman and nicobar': 'Andaman and Nicobar Islands',
  'jammu & kashmir': 'Jammu and Kashmir',
  'nct of delhi': 'Delhi',
  'orissa': 'Odisha',
  'uttaranchal': 'Uttarakhand',
  'pondicherry': 'Puducherry',
  'the dadra and nagar haveli and daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'dadra & nagar haveli and daman & diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'dadra & nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman & diu': 'Dadra and Nagar Haveli and Daman and Diu',
};
function canon(name) {
  const s = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return STATES.find((x) => x.toLowerCase() === s) || STATE_ALIASES[s];
}

// ---------------------------------------------------------------- projection
// Equirectangular, true scale at 23°N, fitted to the inIndia() bounding box.
const LNG0 = 68, LNG1 = 97.5, LAT0 = 6, LAT1 = 37.5;
const COS = Math.cos((23 * Math.PI) / 180);
const WIDTH = 1000;
const K = WIDTH / ((LNG1 - LNG0) * COS); // px per degree of latitude
const KX = K * COS; // px per degree of longitude
const HEIGHT = Math.round((LAT1 - LAT0) * K);
const project = (lat, lng) => [(lng - LNG0) * KX, (LAT1 - lat) * K];
const unproject = (x, y) => [LAT1 - y / K, LNG0 + x / KX];
const r1 = (v) => Math.round(v * 10) / 10;
const inIndia = (lat, lng) => lat >= LAT0 && lat <= LAT1 && lng >= LNG0 && lng <= LNG1;

// ---------------------------------------------------------------- geometry helpers
function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}
function inRings(x, y, rings) { // even-odd over all rings
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
function segDist2(px, py, a, b) {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx || dy) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = px - x; dy = py - y;
  return dx * dx + dy * dy;
}
function signedDist(x, y, rings) {
  let min = Infinity;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) min = Math.min(min, segDist2(x, y, r[i], r[j]));
  return (inRings(x, y, rings) ? 1 : -1) * Math.sqrt(min);
}
function douglasPeucker(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist2(pts[i][0], pts[i][1], pts[a], pts[b]); if (d > max) { max = d; idx = i; } }
    if (idx >= 0 && max > tol * tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : pts; // closed ring needs >= 3 distinct points
}
// Pole of inaccessibility (polylabel algorithm, simple array queue).
function polylabel(rings, precision = 0.05) {
  const outer = rings[0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of outer) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const w = maxX - minX, h = maxY - minY, size = Math.min(w, h);
  const cell = (x, y, s) => { const d = signedDist(x, y, rings); return { x, y, s, d, max: d + s * Math.SQRT2 }; };
  if (size === 0) return [minX, minY];
  const q = [];
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) q.push(cell(x + size / 2, y + size / 2, size / 2));
  let best = cell(minX + w / 2, minY + h / 2, 0);
  while (q.length) {
    q.sort((a, b) => a.max - b.max);
    const c = q.pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const s = c.s / 2;
    q.push(cell(c.x - s, c.y - s, s), cell(c.x + s, c.y - s, s), cell(c.x - s, c.y + s, s), cell(c.x + s, c.y + s, s));
  }
  return [best.x, best.y];
}

// ---------------------------------------------------------------- states
let geojson;
const ISLAND_ONLY = ['Lakshadweep']; // source ST_NM values taken without simplification
if (/\.shp$/i.test(args.states)) {
  const dir = mkdtempSync(join(tmpdir(), 'india-map-'));
  const out = join(dir, 'states.json');
  const islandsOut = join(dir, 'islands.json');
  const ms = (msArgs) => args.mapshaper
    ? execFileSync(args.mapshaper, msArgs, { stdio: 'inherit' })
    : execFileSync('npx', ['--yes', 'mapshaper@0.6.121', ...msArgs], { stdio: 'inherit' });
  // Topology-preserving simplification for the whole country...
  ms([args.states, '-simplify', `interval=${INTERVAL}`, 'keep-shapes', '-o', 'format=geojson', 'precision=0.00001', out]);
  // ...but mapshaper's keep-shapes still collapses Lakshadweep's coral islands into one, so that UT
  // (no land neighbours) is taken unsimplified; rounding to 0.1 px below thins it out anyway.
  const isl = ISLAND_ONLY.map((n) => `ST_NM==${JSON.stringify(n)}`).join(' || ');
  ms([args.states, '-filter', isl, '-o', 'format=geojson', 'precision=0.00001', islandsOut]);
  geojson = JSON.parse(readFileSync(out, 'utf8'));
  const islands = JSON.parse(readFileSync(islandsOut, 'utf8')).features;
  geojson.features = geojson.features.filter((f) => !ISLAND_ONLY.includes(f.properties.ST_NM)).concat(islands);
  rmSync(dir, { recursive: true, force: true });
} else {
  geojson = JSON.parse(readFileSync(args.states, 'utf8'));
}

const byState = new Map(); // name -> array of polygons (each: array of projected rings)
for (const f of geojson.features) {
  const raw = f.properties.ST_NM ?? f.properties.st_nm ?? f.properties.NAME_1 ?? f.properties.name;
  const name = canon(raw);
  if (!name) throw new Error(`Unknown state name in source: ${raw}`);
  const g = f.geometry;
  if (!g) continue;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const list = byState.get(name) || [];
  const thin = ISLAND_ONLY.includes(raw) ? (r) => douglasPeucker(r, 0.15) : (r) => r;
  for (const p of polys) list.push(p.map((ring) => thin(ring.map(([lng, lat]) => project(lat, lng)))));
  byState.set(name, list);
}
const missing = STATES.filter((s) => !byState.has(s));
if (missing.length) throw new Error('States missing from source: ' + missing.join(', '));

const MIN_RING_AREA = 0.25; // px²; smaller islands/holes are dropped (except for tiny UTs)
const TINY_RING_AREA = 0.01; // px² (~0.1 km²); islets below this are dropped even for tiny UTs
const SMALL_STATE_AREA = 150; // px²; states below this keep every ring
function ringToPath(ring) {
  const pts = [];
  for (const [x, y] of ring) {
    const p = [r1(x), r1(y)];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  while (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  return pts;
}
// Multi-part UTs whose largest piece is not the main one: [lat, lng] near the capital.
const LABEL_HINTS = { Puducherry: [11.93, 79.82], Lakshadweep: [10.57, 72.64] };
const shapes = [];
const centroids = {};
const shapeRings = {}; // for validation below
for (const name of STATES) {
  const polys = byState.get(name);
  const total = polys.reduce((s, p) => s + Math.abs(ringArea(p[0])), 0);
  const keepAll = total < SMALL_STATE_AREA;
  const rings = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const raw = poly[i];
      if (Math.abs(ringArea(raw)) < (keepAll ? TINY_RING_AREA : MIN_RING_AREA)) { if (i === 0) break; else continue; }
      let pts = ringToPath(raw);
      if (pts.length < 3 || ringArea(pts) === 0) {
        if (i > 0 || !keepAll) continue;
        // Island too small to survive rounding: draw a tiny diamond so it stays visible.
        const cx = raw.reduce((s, p) => s + p[0], 0) / raw.length, cy = raw.reduce((s, p) => s + p[1], 0) / raw.length;
        pts = [[r1(cx), r1(cy - 0.3)], [r1(cx + 0.3), r1(cy)], [r1(cx), r1(cy + 0.3)], [r1(cx - 0.3), r1(cy)]];
      }
      rings.push({ pts, outer: i === 0, area: Math.abs(ringArea(pts)) });
    }
  }
  if (!rings.length) throw new Error(`No rings left for ${name}`);
  const d = rings.map((r) => 'M' + r.pts.map((p) => `${p[0]},${p[1]}`).join('L') + 'Z').join('');
  // Label point: pole of inaccessibility of the largest outer ring (with the holes that sit inside it).
  const outerRings = rings.filter((r) => r.outer).sort((a, b) => b.area - a.area);
  let main = outerRings[0];
  const hint = LABEL_HINTS[name];
  if (hint) { // label/centroid on the piece nearest the capital rather than the largest piece
    const [hx, hy] = project(hint[0], hint[1]);
    main = outerRings.map((r) => ({ r, d: inRings(hx, hy, [r.pts]) ? -1 : -signedDist(hx, hy, [r.pts]) })).sort((a, b) => a.d - b.d)[0].r;
  }
  const holes = rings.filter((r) => !r.outer && inRings(r.pts[0][0], r.pts[0][1], [main.pts]));
  const [lx, ly] = polylabel([main.pts, ...holes.map((h) => h.pts)]);
  const [lat, lng] = unproject(lx, ly);
  const c = [Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4];
  const [px, py] = project(c[0], c[1]);
  const all = rings.map((r) => r.pts);
  if (!inRings(px, py, all)) throw new Error(`Label point outside ${name}`);
  centroids[name] = c;
  shapeRings[name] = all;
  shapes.push({ name, d, cx: r1(px), cy: r1(py) });
}
function stateAt(lat, lng) {
  const [x, y] = project(lat, lng);
  for (const n of STATES) if (inRings(x, y, shapeRings[n])) return n;
  return undefined;
}

// ---------------------------------------------------------------- PIN prefixes
function parseCsv(text) {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = ''; rows.push(row); row = [];
    } else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const pinRows = parseCsv(readFileSync(args.pins, 'utf8').replace(/^﻿/, ''));
const hdr = pinRows.shift().map((h) => h.trim().toLowerCase());
const col = (n) => { const i = hdr.indexOf(n); if (i < 0) throw new Error(`pins CSV lacks column ${n}`); return i; };
const iPin = col('pincode'), iState = col('statename'), iLat = col('latitude'), iLng = col('longitude');
const pre = new Map(); // prefix -> { states: Map, pts: [], ptsInState: [] } (points tagged with state)
let pinTotal = 0, pinValid = 0;
const unknownStates = new Set();
for (const r of pinRows) {
  if (r.length < hdr.length) continue;
  const pin = r[iPin].trim();
  if (!/^[1-9]\d{5}$/.test(pin)) continue;
  pinTotal++;
  const state = canon(r[iState]);
  if (!state) { unknownStates.add(r[iState]); continue; }
  const p = pre.get(pin.slice(0, 3)) || { states: new Map(), pts: [] };
  p.states.set(state, (p.states.get(state) || 0) + 1);
  const lat = Number(r[iLat]), lng = Number(r[iLng]);
  if (r[iLat].trim() && r[iLng].trim() && Number.isFinite(lat) && Number.isFinite(lng) && inIndia(lat, lng)) {
    pinValid++;
    p.pts.push({ lat, lng, state });
  }
  pre.set(pin.slice(0, 3), p);
}
if (unknownStates.size) console.warn('Unmapped StateName values ignored:', [...unknownStates]);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pinPrefix = {};
const pinStats = { median: 0, fallbackAllPoints: 0, fallbackCentroid: 0 };
for (const k of [...pre.keys()].sort()) {
  const p = pre.get(k);
  const state = [...p.states.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  // Prefer coordinates that actually fall inside the office's stated state (drops mis-keyed rows).
  let pts = p.pts.filter((q) => q.state === state && stateAt(q.lat, q.lng) === state);
  if (pts.length) pinStats.median++;
  else if ((pts = p.pts.filter((q) => q.state === state)).length) pinStats.fallbackAllPoints++;
  let lat, lng;
  if (pts.length) { lat = median(pts.map((q) => q.lat)); lng = median(pts.map((q) => q.lng)); }
  else { [lat, lng] = centroids[state]; pinStats.fallbackCentroid++; }
  pinPrefix[k] = { state, lat: Math.round(lat * 1e3) / 1e3, lng: Math.round(lng * 1e3) / 1e3 };
}

// ---------------------------------------------------------------- cities (GeoNames)
// Every state/UT capital, solar-market and district towns. Big cities (>= 3 lakh) are added automatically.
const EXTRA_CITIES = `
port blair,amaravati,itanagar,dispur,patna,raipur,panaji,gandhinagar,chandigarh,shimla,ranchi,bengaluru,
thiruvananthapuram,bhopal,mumbai,imphal,shillong,aizawl,kohima,bhubaneswar,jaipur,gangtok,chennai,hyderabad,
agartala,lucknow,dehradun,kolkata,new delhi,delhi,srinagar,jammu,leh,kargil,puducherry,kavaratti,daman,diu,silvassa,
anand,nadiad,mehsana,palanpur,bharuch,ankleshwar,vapi,navsari,valsad,morbi,gondal,porbandar,bhuj,gandhidham,
surendranagar,amreli,himatnagar,godhra,dahod,patan,botad,veraval,jaisalmer,barmer,phalodi,pokaran,sikar,jhunjhunu,
churu,nagaur,pali,sri ganganagar,hanumangarh,tonk,chittorgarh,banswara,dungarpur,sirohi,jalor,bharatpur,dausa,beawar,
kishangarh,rewa,satna,sagar,neemuch,mandsaur,ratlam,dewas,khandwa,khargone,shajapur,chhindwara,katni,singrauli,
vidisha,hoshangabad,morena,shivpuri,guna,satara,baramati,osmanabad,beed,jalna,wardha,yavatmal,washim,buldana,
hingoli,ratnagiri,palghar,panvel,karad,ichalkaranji,bhusawal,chandrapur,gondia,bhandara,nandurbar,
chitradurga,raichur,bidar,hassan,mandya,udupi,tumakuru,kolar,chik ballapur,bagalkot,gadag,koppal,hosapete,
hubballi,pavagada,karwar,chikmagalur,ramanathapuram,virudunagar,sivakasi,dindigul,karur,namakkal,thanjavur,
kumbakonam,nagercoil,hosur,krishnagiri,dharmapuri,cuddalore,villupuram,kanchipuram,tiruvannamalai,pollachi,ooty,
anantapur,kadapa,kurnool,tirupati,chittoor,ongole,eluru,srikakulam,vizianagaram,machilipatnam,bhimavaram,tenali,
nandyal,hindupur,rajahmundry,karimnagar,khammam,mahbubnagar,nalgonda,siddipet,adilabad,suryapet,secunderabad,
noida,greater noida,ayodhya,sultanpur,jhansi,banda,mirzapur,etawah,mainpuri,hapur,bulandshahr,rampur,bijnor,
sitapur,hardoi,unnao,rae bareli,azamgarh,ballia,deoria,basti,gonda,bahraich,lakhimpur,pilibhit,budaun,etah,
kannauj,fatehpur,lalitpur,jaunpur,ghazipur,bathinda,mohali,hoshiarpur,pathankot,moga,firozpur,sangrur,barnala,
kapurthala,phagwara,rupnagar,panipat,sonipat,ambala,yamunanagar,panchkula,bhiwani,sirsa,rewari,jind,thanesar,
kaithal,palwal,dharamshala,mandi,solan,kullu,manali,baddi,una,haridwar,roorkee,haldwani,rudrapur,kashipur,
rishikesh,nainital,purnia,darbhanga,arrah,begusarai,katihar,munger,chhapra,sasaram,hajipur,bettiah,motihari,siwan,
saharsa,bodh gaya,deoghar,hazaribagh,giridih,dumka,kharagpur,haldia,bardhaman,english bazar,baharampur,
krishnanagar,jalpaiguri,cooch behar,darjeeling,rourkela,sambalpur,puri,balasore,bhadrak,baripada,jharsuguda,angul,
durg,raj-nandgaon,raigarh,ambikapur,jagdalpur,kannur,kasaragod,palakkad,malappuram,alappuzha,kottayam,
pathanamthitta,thalassery,kochi,thrissur,kollam,kozhikode,margao,vasco da gama,mapusa,ponda,dimapur,silchar,
dibrugarh,jorhat,tezpur,nagaon,tinsukia,tura,naharlagun,anantnag,baramula,udhampur,kathua,karaikal,mahe,yanam,
dhanbad,bokaro,jamshedpur,gaya,bhagalpur,muzaffarpur,siliguri,asansol,durgapur,cuttack,brahmapur,bilaspur,korba,
bhilai,gwalior,indore,jabalpur,ujjain,nagpur,nashik,aurangabad,solapur,kolhapur,sangli,amravati,akola,latur,nanded,
jalgaon,dhule,ahmednagar,surat,vadodara,rajkot,bhavnagar,jamnagar,junagadh,ahmedabad,jodhpur,udaipur,kota,ajmer,
bikaner,alwar,bhilwara,varanasi,prayagraj,kanpur,agra,meerut,ghaziabad,aligarh,bareilly,moradabad,saharanpur,
gorakhpur,mathura,firozabad,shahjahanpur,muzaffarnagar,ludhiana,amritsar,jalandhar,patiala,faridabad,gurugram,
rohtak,hisar,karnal,mysuru,mangaluru,belagavi,kalaburagi,ballari,vijayapura,davanagere,shivamogga,coimbatore,
madurai,tiruchirappalli,salem,tirunelveli,tiruppur,erode,vellore,thoothukudi,visakhapatnam,vijayawada,guntur,
nellore,kakinada,warangal,nizamabad,ramagundam,thane,pune,navi mumbai,kalyan,bhiwandi,virar,malegaon
`.split(',').map((s) => s.trim()).filter(Boolean);

// Alternate spellings -> key that exists in the table.
const CITY_ALIASES = {
  bangalore: 'bengaluru', gurgaon: 'gurugram', bombay: 'mumbai', calcutta: 'kolkata', madras: 'chennai',
  poona: 'pune', trivandrum: 'thiruvananthapuram', baroda: 'vadodara', mysore: 'mysuru', vizag: 'visakhapatnam',
  vishakhapatnam: 'visakhapatnam', allahabad: 'prayagraj', mangalore: 'mangaluru', hubli: 'hubballi',
  'hubli-dharwad': 'hubballi', belgaum: 'belagavi', gulbarga: 'kalaburagi', bellary: 'ballari', bijapur: 'vijayapura',
  shimoga: 'shivamogga', tumkur: 'tumakuru', davangere: 'davanagere', hospet: 'hosapete', cochin: 'kochi',
  ernakulam: 'kochi', calicut: 'kozhikode', quilon: 'kollam', trichur: 'thrissur', alleppey: 'alappuzha',
  cannanore: 'kannur', palghat: 'palakkad', trichy: 'tiruchirappalli', tiruchi: 'tiruchirappalli',
  tuticorin: 'thoothukudi', tirupur: 'tiruppur', conjeevaram: 'kanchipuram', kanchi: 'kanchipuram',
  udhagamandalam: 'ooty', ootacamund: 'ooty', pondicherry: 'puducherry', pondy: 'puducherry', panjim: 'panaji',
  madgaon: 'margao', vasco: 'vasco da gama', benares: 'varanasi', banaras: 'varanasi', kashi: 'varanasi',
  cawnpore: 'kanpur', faizabad: 'ayodhya', 'raebareli': 'rae bareli', 'lakhimpur kheri': 'lakhimpur',
  'shahjanpur': 'shahjahanpur', 'gautam buddha nagar': 'noida', 'new bombay': 'navi mumbai', buldhana: 'buldana', virudhunagar: 'virudunagar',
  kurukshetra: 'thanesar', rajnandgaon: 'raj-nandgaon', 'raj nandgaon': 'raj-nandgaon', baramulla: 'baramula',
  'vasai-virar': 'virar', 'vasai virar': 'virar', bassein: 'vasai', 'hubli dharwad': 'hubballi',
  'chhatrapati sambhajinagar': 'aurangabad', 'sambhajinagar': 'aurangabad',
  ahilyanagar: 'ahmednagar', dharashiv: 'osmanabad', sholapur: 'solapur', 'kalyan-dombivli': 'kalyan',
  'nasik': 'nashik', 'bhusaval': 'bhusawal', 'amraoti': 'amravati', 'chanda': 'chandrapur',
  'rajamahendravaram': 'rajahmundry', 'rajamundry': 'rajahmundry', 'anantapuramu': 'anantapur',
  'cuddapah': 'kadapa', 'ysr kadapa': 'kadapa', 'bezawada': 'vijayawada', 'masulipatnam': 'machilipatnam',
  'nellore city': 'nellore', 'tirupathi': 'tirupati', 'warangal urban': 'warangal', 'ramgundam': 'ramagundam',
  'mahabubnagar': 'mahbubnagar', 'cyberabad': 'hyderabad', 'secundrabad': 'secunderabad',
  'jullundur': 'jalandhar', 'ferozepur': 'firozpur', 'bhatinda': 'bathinda', 'sas nagar': 'mohali',
  'sahibzada ajit singh nagar': 'mohali', 'ropar': 'rupnagar', 'sonepat': 'sonipat', 'hissar': 'hisar',
  'dharamsala': 'dharamshala', 'simla': 'shimla', 'dehra dun': 'dehradun', 'hardwar': 'haridwar',
  'gaya ji': 'gaya', 'arra': 'arrah', 'chapra': 'chhapra', 'purnea': 'purnia', 'monghyr': 'munger',
  'bokaro steel city': 'bokaro', 'tatanagar': 'jamshedpur', 'burdwan': 'bardhaman', 'malda': 'english bazar',
  'berhampore': 'baharampur', 'koch bihar': 'cooch behar', 'darjiling': 'darjeeling', 'berhampur': 'brahmapur',
  'baleshwar': 'balasore', 'raurkela': 'rourkela', 'bhilai nagar': 'bhilai', 'durg-bhilai': 'bhilai',
  'jubbulpore': 'jabalpur', 'narmadapuram': 'hoshangabad', 'ujjayini': 'ujjain', 'gauhati': 'guwahati',
  'shilong': 'shillong', 'kavaratti island': 'kavaratti', 'sri vijaya puram': 'port blair',
  'portblair': 'port blair', 'silvasa': 'silvassa', 'nct delhi': 'delhi', 'ncr': 'delhi', 'dilli': 'delhi',
  'ganganagar': 'sri ganganagar', 'jalore': 'jalor', 'chittaurgarh': 'chittorgarh', 'himmatnagar': 'himatnagar',
  'mehsana city': 'mehsana', 'mahesana': 'mehsana', 'kutch': 'bhuj', 'kachchh': 'bhuj', 'somnath': 'veraval',
  'chikkaballapur': 'chik ballapur', 'chikkamagaluru': 'chikmagalur', 'kodaikanal': 'dindigul',
  'kanyakumari': 'nagercoil', 'thanjore': 'thanjavur', 'tanjore': 'thanjavur', 'villupuram': 'villupuram',
  'viluppuram': 'villupuram', 'kancheepuram': 'kanchipuram', 'thiruvannamalai': 'tiruvannamalai',
};

// Not present in GeoNames cities1000 as separate places: approximate town-centre coordinates.
const MANUAL_CITIES = { dharwad: [15.4589, 75.0078], vasai: [19.3919, 72.8397] };

const gnRows = readFileSync(args.cities, 'utf8').split('\n').map((l) => l.split('\t')).filter((r) => r.length > 14 && r[8] === 'IN');
const PLACE_CODES = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLC', 'PPLG', 'PPLX']); // PPLX (city sections) only for named lookups
const places = gnRows
  .filter((r) => PLACE_CODES.has(r[7]))
  .map((r) => ({ name: r[1], ascii: r[2], alt: r[3], lat: Number(r[4]), lng: Number(r[5]), code: r[7], pop: Number(r[14]) || 0 }))
  .filter((p) => inIndia(p.lat, p.lng));
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
const byName = new Map();
const byAlt = new Map();
const addTo = (m, k, p) => { const cur = m.get(k); if (!cur || p.pop > cur.pop) m.set(k, p); };
for (const p of places) {
  addTo(byName, norm(p.name), p);
  addTo(byName, norm(p.ascii), p);
  addTo(byName, norm(p.ascii).replace(/[-\s]/g, ''), p);
  for (const a of p.alt.split(',')) if (a && /^[\x20-\x7e]+$/.test(a)) addTo(byAlt, norm(a), p);
}
const cities = {};
const fix = (p) => [Math.round(p.lat * 1e4) / 1e4, Math.round(p.lng * 1e4) / 1e4];
for (const p of places) if (p.pop >= 300000 && p.code !== 'PPLX') { const k = norm(p.ascii); if (!cities[k] || byName.get(k) === p) cities[k] = fix(byName.get(k)); }
const notFound = [];
for (const [k, v] of Object.entries(MANUAL_CITIES)) cities[k] = v;
for (const n of EXTRA_CITIES) {
  const k = norm(n);
  const p = byName.get(k) || byAlt.get(k);
  if (p) cities[k] = fix(p); else notFound.push(n);
}
for (const [alias, target] of Object.entries(CITY_ALIASES)) {
  if (cities[target] && !cities[alias]) cities[alias] = cities[target];
  else if (!cities[target]) notFound.push(`${alias} -> ${target}`);
}
if (notFound.length) console.warn('Cities not found in GeoNames (skipped):', notFound.join('; '));
const outside = Object.entries(cities).filter(([, [la, ln]]) => !stateAt(la, ln)).map(([k]) => k);
if (outside.length) console.warn('Cities whose point falls outside every simplified state (coast/rounding):', outside.join(', '));

// ---------------------------------------------------------------- emit
const js = (v) => JSON.stringify(v);
const sortedObj = (o) => Object.keys(o).sort();
const lines = [];
lines.push(`/* AUTO-GENERATED by scripts/build-india-map.mjs — do not edit by hand; re-run the script instead.
 *
 * Data sources (see docs/third-party/map-data-sources.md):
 * - State/UT boundaries: DataMeet India community, "States/Admin2" (https://github.com/datameet/maps),
 *   CC BY 4.0. Follows the Survey of India external boundary. Simplified and projected.
 * - PIN prefixes: All India Pincode Directory, Department of Posts via data.gov.in,
 *   Government Open Data License - India (GODL). Median office location per 3-digit prefix.
 * - Cities: GeoNames (https://www.geonames.org), CC BY 4.0.
 */
import { canonicalState } from '../states';

/** SVG viewBox size, i.e. viewBox="0 0 width height". */
export const VIEWBOX: { width: number; height: number } = { width: ${WIDTH}, height: ${HEIGHT} };

const LNG0 = ${LNG0};
const LAT1 = ${LAT1};
const K = ${K}; // px per degree latitude
const KX = ${KX}; // px per degree longitude (K * cos 23°)

/** Equirectangular projection (true scale at 23°N) used to draw STATE_SHAPES. Returns [x, y] in VIEWBOX units. */
export function project(lat: number, lng: number): [number, number] {
  return [(lng - LNG0) * KX, (LAT1 - lat) * K];
}

/** Rough bounding box of India (lat ${LAT0}–${LAT1}, lng ${LNG0}–${LNG1}). */
export function inIndia(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= ${LAT0} && lat <= ${LAT1} && lng >= ${LNG0} && lng <= ${LNG1};
}

/** One entry per state/UT. \`d\` is an SVG path (multiple subpaths for islands/enclaves); cx/cy is a label point inside it. */
export const STATE_SHAPES: { name: string; d: string; cx: number; cy: number }[] = [`);
for (const s of shapes) lines.push(`  { name: ${js(s.name)}, cx: ${s.cx}, cy: ${s.cy}, d: ${js(s.d)} },`);
lines.push(`];

/** [lat, lng] label/fallback point per state/UT (guaranteed to fall inside its shape). */
export const STATE_CENTROIDS: Record<string, [number, number]> = {`);
for (const n of STATES) lines.push(`  ${js(n)}: [${centroids[n][0]}, ${centroids[n][1]}],`);
lines.push(`};

/** [lat, lng] for lowercase city names (with common alias spellings). */
export const CITY_COORDS: Record<string, [number, number]> = {`);
const cityKeys = sortedObj(cities);
for (let i = 0; i < cityKeys.length; i += 4) lines.push('  ' + cityKeys.slice(i, i + 4).map((k) => `${js(k)}: [${cities[k][0]}, ${cities[k][1]}]`).join(', ') + ',');
lines.push(`};

const P = (state: string, lat: number, lng: number) => ({ state, lat, lng });
/** First 3 digits of a PIN code -> majority state and approximate centre of its post offices. */
export const PIN_PREFIX: Record<string, { state: string; lat: number; lng: number }> = {`);
const pinKeys = sortedObj(pinPrefix);
for (let i = 0; i < pinKeys.length; i += 3) lines.push('  ' + pinKeys.slice(i, i + 3).map((k) => { const v = pinPrefix[k]; return `'${k}': P(${js(v.state)}, ${v.lat}, ${v.lng})`; }).join(', ') + ',');
lines.push(`};

const STATE_ALIASES: Record<string, string> = ${js(STATE_ALIASES)};

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v.trim()); return Number.isFinite(n) ? n : undefined; }
  return undefined;
}

function pinPrefixOf(pin: unknown): string | undefined {
  if (typeof pin !== 'string' && typeof pin !== 'number') return undefined;
  const s = String(pin).replace(/\\s+/g, '');
  return /^[1-9]\\d{5}$/.test(s) ? s.slice(0, 3) : undefined;
}

/** State for a 6-digit Indian PIN code (by its 3-digit prefix), or undefined. */
export function stateFromPincode(pin: unknown): string | undefined {
  const p = pinPrefixOf(pin);
  return p ? PIN_PREFIX[p]?.state : undefined;
}

const CITY_SUFFIX = /[\\s,-]+(city|town|district|dist|distt|urban|rural|nagar nigam|municipal corporation|corporation|cantonment|cantt|metro|division|tehsil|taluka|taluk)$/;

function cityLookup(city: unknown): [number, number] | undefined {
  if (typeof city !== 'string') return undefined;
  let s = city.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[.()]/g, ' ').replace(/\\s+/g, ' ').trim();
  const tries = new Set<string>();
  for (let i = 0; i < 3 && s; i++) {
    tries.add(s);
    tries.add(s.split(',')[0].trim());
    s = s.replace(CITY_SUFFIX, '').trim();
  }
  for (const t of tries) if (t && Object.prototype.hasOwnProperty.call(CITY_COORDS, t)) return CITY_COORDS[t];
  return undefined;
}

function stateLookup(state: unknown): string | undefined {
  if (typeof state !== 'string') return undefined;
  const s = state.trim().toLowerCase().replace(/\\s+/g, ' ');
  return canonicalState(s) ?? STATE_ALIASES[s];
}

/**
 * Best available map position for a record. Priority: valid lat/lng inside India ('exact'),
 * 6-digit PIN code ('pincode'), known city ('city'), state/UT centre ('state'); otherwise null.
 */
export function locate(input: { pincode?: unknown; city?: unknown; state?: unknown; lat?: unknown; lng?: unknown }):
  { lat: number; lng: number; precision: 'exact' | 'pincode' | 'city' | 'state' } | null {
  if (!input) return null;
  const lat = toNum(input.lat), lng = toNum(input.lng);
  if (lat !== undefined && lng !== undefined && inIndia(lat, lng)) return { lat, lng, precision: 'exact' };
  const p = pinPrefixOf(input.pincode);
  const pin = p ? PIN_PREFIX[p] : undefined;
  if (pin) return { lat: pin.lat, lng: pin.lng, precision: 'pincode' };
  const c = cityLookup(input.city);
  if (c) return { lat: c[0], lng: c[1], precision: 'city' };
  const st = stateLookup(input.state);
  const sc = st ? STATE_CENTROIDS[st] : undefined;
  if (sc) return { lat: sc[0], lng: sc[1], precision: 'state' };
  return null;
}
`);
writeFileSync(OUT, lines.join('\n'));
const size = Buffer.byteLength(lines.join('\n'));
console.log(`Wrote ${OUT}: ${(size / 1024).toFixed(1)} KB, ${shapes.length} shapes, ${cityKeys.length} city keys, ${pinKeys.length} PIN prefixes.`);
console.log(`PIN rows: ${pinTotal} valid-format, ${pinValid} with usable coordinates; prefixes: ${pinStats.median} median-in-state, ${pinStats.fallbackAllPoints} median-unchecked, ${pinStats.fallbackCentroid} state-centroid fallback.`);
for (const s of shapes) console.log(`  ${s.name.padEnd(42)} ${(s.d.length / 1024).toFixed(1).padStart(6)} KB  ${(s.d.match(/M/g) || []).length} rings`);
