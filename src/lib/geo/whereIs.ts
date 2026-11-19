// "Where is this?" for a GPS point in India, offline: the nearest town, its district and state, a Plus Code.
// Uses the bundled GeoNames towns (loaded only when needed) and district list.
import { DISTRICTS } from './districts';
import { project } from './indiaMap';
import { stateAtXY } from './mapLayers';
import { plusCode, shortPlusCode } from './plusCode';
import { canonicalState } from '../states';

export interface Place {
  lat: number;
  lng: number;
  /** nearest town or city (within ~25 km), if any */
  town?: string;
  /** km from the town */
  townKm?: number;
  district?: string;
  state?: string;
  /** "7MR56Q53+H69" */
  plusCode: string;
  /** "6Q53+H69, Pirthipur" when a town is near */
  shortCode: string;
  /** one line, e.g. "Pirthipur, Madhya Pradesh, India" */
  title: string;
  /** e.g. "6Q53+H69, Pirthipur, Niwari district, Madhya Pradesh" */
  address: string;
}

type Towns = { PLACES: [string, number, number, number, number][]; PLACE_STATES: string[] };
let towns: Towns | null = null;
/** Loads the town list (about 280 KB, kept separate from the rest of the app). */
export async function loadTowns(): Promise<void> {
  if (!towns) towns = await import('./places');
}

const km = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dx = (aLng - bLng) * Math.cos((aLat * Math.PI) / 180), dy = aLat - bLat;
  return Math.sqrt(dx * dx + dy * dy) * 111.2;
};

export function nearbyTowns(lat: number, lng: number, radiusKm: number, limit = 12): { name: string; lat: number; lng: number; pop: number; km: number }[] {
  if (!towns) return [];
  const out: { name: string; lat: number; lng: number; pop: number; km: number }[] = [];
  for (const [name, , tLat, tLng, pop] of towns.PLACES) {
    if (Math.abs(tLat - lat) > radiusKm / 100 || Math.abs(tLng - lng) > radiusKm / 90) continue;
    const d = km(lat, lng, tLat, tLng);
    if (d <= radiusKm) out.push({ name, lat: tLat, lng: tLng, pop, km: d });
  }
  return out.sort((a, b) => b.pop - a.pop).slice(0, limit);
}

/** Describes a point. Call loadTowns() first for town names (without it: district, state and code only). */
export function whereIs(lat: number, lng: number): Place {
  const code = plusCode(lat, lng);
  let state = stateAtXY(...project(lat, lng));
  // The town: the closest one, preferring a bigger town when it is nearly as close.
  let town: { name: string; lat: number; lng: number; km: number; state: string } | undefined;
  if (towns) {
    let best = Infinity;
    for (const [name, si, tLat, tLng, pop] of towns.PLACES) {
      if (Math.abs(tLat - lat) > 0.3 || Math.abs(tLng - lng) > 0.3) continue;
      const d = km(lat, lng, tLat, tLng);
      const score = d - Math.min(3, Math.log10(Math.max(pop, 1)) - 3); // up to 3 km head start for big towns
      if (d <= 25 && score < best) { best = score; town = { name, lat: tLat, lng: tLng, km: d, state: towns.PLACE_STATES[si] }; }
    }
  }
  if (!state && town) state = canonicalState(town.state) || town.state;
  let district: string | undefined;
  let dBest = Infinity;
  for (const [name, st, dLat, dLng] of DISTRICTS) {
    if (state && canonicalState(st) !== state && !(st === 'Andaman and Nicobar' && state.startsWith('Andaman'))) continue;
    const d = km(lat, lng, dLat, dLng);
    if (d < dBest) { dBest = d; district = name; }
  }
  if (dBest > 150) district = undefined;
  const short = town ? shortPlusCode(code, lat, lng, town.lat, town.lng) : null;
  const shortCode = short && town ? `${short}, ${town.name}` : code;
  const title = [town?.name || district, state, 'India'].filter(Boolean).join(', ');
  const address = [shortCode, district && district !== town?.name ? `${district} district` : '', state].filter(Boolean).join(', ');
  return { lat, lng, town: town?.name, townKm: town ? Math.round(town.km * 10) / 10 : undefined, district, state, plusCode: code, shortCode, title, address };
}
