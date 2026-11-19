// Search history for a list ("Recently used"): the last few filter set-ups, per person, on this device.
import type { SearchState } from '../modules/search';

export const MAX_RECENT = 7;
const key = (userId: string, entity: string) => `ss1:recent:${userId}:${entity}`;

export type RecentSearch = SearchState & { at?: string };

/** Only filters, field searches, custom filters and grouping count — typing alone is not worth keeping. */
export function isWorthKeeping(st: SearchState): boolean {
  return st.f.length + st.s.length + (st.c?.length || 0) + st.g.length > 0;
}

const sig = (st: SearchState) => JSON.stringify({ f: [...st.f].sort(), s: st.s, c: st.c || [], g: st.g });
export const sameSearch = (a: SearchState, b: SearchState) => sig(a) === sig(b);

export function recentSearches(userId: string, entity: string): RecentSearch[] {
  try {
    const list = JSON.parse(localStorage.getItem(key(userId, entity)) || '[]') as RecentSearch[];
    return Array.isArray(list) ? list.filter((x) => x && Array.isArray(x.f)).map((x) => ({ ...x, c: x.c || [], s: x.s || [], g: x.g || [] })).slice(0, MAX_RECENT) : [];
  } catch { return []; }
}

export function rememberSearch(userId: string, entity: string, st: SearchState): void {
  if (!userId || !isWorthKeeping(st)) return;
  const clean: RecentSearch = { q: '', f: st.f, s: st.s, c: st.c || [], g: st.g, at: new Date().toISOString() };
  const list = [clean, ...recentSearches(userId, entity).filter((x) => !sameSearch(x, clean))].slice(0, MAX_RECENT);
  try { localStorage.setItem(key(userId, entity), JSON.stringify(list)); } catch { /* storage blocked: a convenience only */ }
}

export function clearRecent(userId: string, entity: string): void {
  try { localStorage.removeItem(key(userId, entity)); } catch { /* nothing to clear */ }
}
