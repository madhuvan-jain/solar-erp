// The order of records in the list the person last looked at, so a record can step to the next or
// previous one (‹ 3 / 25 ›) in that same order — after filters, search and sorting.
const key = (entity: string) => `ss1:order:${entity}`;

export function rememberOrder(entity: string, ids: string[]): void {
  try { sessionStorage.setItem(key(entity), JSON.stringify(ids.slice(0, 5000))); } catch { /* not available: the arrows follow the default order */ }
}

export function listOrder(entity: string): string[] | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(key(entity)) || 'null');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
  } catch { return null; }
}
