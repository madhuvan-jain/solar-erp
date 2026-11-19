// Saved searches ("Favorites") for a list, per person, on this device.
import type { SearchState } from '../ui/components/SearchPanel';

export interface Favorite { name: string; state: SearchState; isDefault?: boolean }

const key = (userId: string, entity: string) => `ss1:favs:${userId}:${entity}`;

export function favoritesFor(userId: string, entity: string): Favorite[] {
  try {
    const list = JSON.parse(localStorage.getItem(key(userId, entity)) || '[]') as Favorite[];
    return Array.isArray(list) ? list.filter((f) => f && typeof f.name === 'string' && f.state) : [];
  } catch { return []; }
}

function write(userId: string, entity: string, list: Favorite[]) {
  try { localStorage.setItem(key(userId, entity), JSON.stringify(list.slice(0, 30))); } catch { /* storage blocked: favorites are a convenience */ }
}

/** Same name replaces the old one; only one favorite can open by default. */
export function saveFavorite(userId: string, entity: string, fav: Favorite): void {
  const rest = favoritesFor(userId, entity).filter((f) => f.name !== fav.name).map((f) => (fav.isDefault ? { ...f, isDefault: false } : f));
  write(userId, entity, [...rest, fav]);
}

export function deleteFavorite(userId: string, entity: string, name: string): void {
  write(userId, entity, favoritesFor(userId, entity).filter((f) => f.name !== name));
}

export function defaultFavorite(userId: string, entity: string): Favorite | undefined {
  return favoritesFor(userId, entity).find((f) => f.isDefault);
}

import { sameSearch } from './recentSearches';

export function isFavorite(userId: string, entity: string, st: SearchState): boolean {
  return favoritesFor(userId, entity).some((f) => sameSearch(f.state, st));
}

/** Star / unstar a search. Returns true when it is now a favorite. */
export function toggleFavorite(userId: string, entity: string, name: string, st: SearchState): boolean {
  const list = favoritesFor(userId, entity);
  const hit = list.find((f) => sameSearch(f.state, st));
  if (hit) { write(userId, entity, list.filter((f) => f !== hit)); return false; }
  write(userId, entity, [...list.filter((f) => f.name !== name), { name, state: { ...st, q: '' } }]);
  return true;
}

/** The favorite that opens by itself when the list opens (or none). */
export function setDefaultFavorite(userId: string, entity: string, name: string | null): void {
  write(userId, entity, favoritesFor(userId, entity).map((f) => ({ ...f, isDefault: f.name === name })));
}

