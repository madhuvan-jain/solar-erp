import type { Rec } from '../schema';
import type { Store } from '../store/store';
import { canonicalState, stateFromGstin } from '../states';
import { locate, project, stateFromPincode } from './indiaMap';
import { stateAtXY } from './mapLayers';
import { LINKS } from './mappable';

export { isMappableEntity } from './mappable';

export type Precision = 'exact' | 'pincode' | 'city' | 'state';
export interface RecordPlace { lat: number; lng: number; precision: Precision; state?: string; city?: string }

const RANK: Record<Precision, number> = { exact: 4, pincode: 3, city: 2, state: 1 };

function stateOf(rec: Rec): string | undefined {
  return canonicalState(rec.state) || canonicalState(rec.placeOfSupply) || stateFromGstin(rec.gstin) || stateFromPincode(rec.pincode);
}

/**
 * Best known location of a record: its own GPS / PIN / city / state, or — if a linked
 * customer, project, lead or vendor knows more precisely — theirs.
 */
export function recordLocation(store: Store, entityKey: string, rec: Rec | undefined, depth = 0): RecordPlace | null {
  if (!rec) return null;
  const state = stateOf(rec);
  const own = locate({
    lat: rec.lat ?? rec.siteLat, lng: rec.lng ?? rec.siteLng, pincode: rec.pincode, city: rec.city, state,
  });
  const city = typeof rec.city === 'string' && rec.city.trim() ? rec.city.trim() : undefined;
  let best: RecordPlace | null = own ? { ...own, state, city } : null;
  if (best?.precision === 'exact' || depth >= 2) return best && !best.state ? { ...best, state: stateAtXY(...project(best.lat, best.lng)) } : best;
  for (const [field, target] of LINKS) {
    if (!rec[field] || target === entityKey) continue;
    const linked = recordLocation(store, target, store.get(target, rec[field]), depth + 1);
    if (linked && (!best || RANK[linked.precision] > RANK[best.precision])) best = { ...linked, state: best?.state || linked.state, city: city || linked.city };
    if (best?.precision === 'exact') break;
  }
  // Only GPS or a city typed: the state is whichever one the point falls in.
  if (best && !best.state) best = { ...best, state: stateAtXY(...project(best.lat, best.lng)) };
  return best;
}
