// Keeping people's data safe when a new version of the app is installed.
//
// 1. Every business on a device records the DATA FORMAT its records are saved in. A new version that needs
//    records in a new shape adds a MIGRATION; on first start it upgrades the stored records once — after
//    putting a full SAFETY COPY aside — and never touches anything it does not understand.
// 2. Data saved by a NEWER version is never overwritten by an older one: the older app opens it read-only.
// 3. Safety copies (automatic once a day, before every upgrade, restore and demo load, or on request) live in
//    the browser's IndexedDB, separate from the live data, and can be restored or downloaded in
//    Settings → Backup & data.
// Cloud mode keeps records in the database, where the same migrations are applied as records are read.
import type { Rec } from '../schema';
import type { DataMap } from './types';

declare const __APP_VERSION__: string | undefined;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** The shape records are saved in. Raise it only together with a new entry in MIGRATIONS. */
export const DATA_FORMAT = 2;

export interface Migration {
  /** the format this step produces */
  to: number;
  what: string;
  /**
   * Must keep every record and every field it does not change, must never delete records, and must give
   * the same result when run twice (cloud mode applies it on every read until the record is saved again).
   */
  run(data: DataMap): DataMap;
}

/** Append only: a step that has shipped is never edited or removed. */
export const MIGRATIONS: Migration[] = [
  {
    to: 2,
    what: 'Record the data format; tidy record lists (drop empty slots, never records)',
    run: (data) => Object.fromEntries(Object.entries(data).map(([k, list]) => [k, Array.isArray(list) ? list.filter((r): r is Rec => !!r && typeof r === 'object' && typeof r.id === 'string') : []])),
  },
];

/** Upgrades records saved in format `from` to the current one. Unknown entities and fields pass through. */
export function migrate(data: DataMap, from: number, to = DATA_FORMAT): DataMap {
  let out = data;
  for (const m of MIGRATIONS) if (m.to > from && m.to <= to) out = m.run(out);
  return out;
}

export const newerDataMessage = (format: number) =>
  `This data was saved by a newer version of SuryaSetu (data format ${format}; this app reads up to ${DATA_FORMAT}). ` +
  'Nothing will be changed so it stays safe — reload the page or update the app to keep working.';

// ---------------------------------------------------------------- safety copies (IndexedDB)

export type CopyReason = 'daily' | 'before-update' | 'before-restore' | 'manual';
export const REASON_LABEL: Record<CopyReason, string> = {
  daily: 'Daily automatic copy', 'before-update': 'Before an app update', 'before-restore': 'Before a restore or demo data', manual: 'Made by hand',
};

export interface SafetyCopyInfo { id: string; workspace: string; at: string; reason: CopyReason; appVersion: string; format: number; records: number }
export interface SafetyCopy extends SafetyCopyInfo { data: DataMap; counters: Record<string, number> }

const DB = 'ss1-safety';
const STORE = 'copies';
const INFO = 'info';
/** How many copies each business keeps: the newest of each kind always stays. */
const KEEP = 14;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    // Never hold up the app: if the browser does not answer within 4 s, carry on without a copy.
    const t = setTimeout(() => resolve(null), 4000);
    const done = (v: IDBDatabase | null) => { clearTimeout(t); resolve(v); };
    try {
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        const t = req.transaction!;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        // Version 2: a small list of the copies (no data), so listing them never reads every full copy.
        if (!db.objectStoreNames.contains(INFO)) {
          const infos = db.createObjectStore(INFO, { keyPath: 'id' });
          const cur = t.objectStore(STORE).openCursor();
          cur.onsuccess = () => { const c = cur.result; if (c) { infos.put(info(c.value as SafetyCopy)); c.continue(); } };
        }
      };
      req.onsuccess = () => done(req.result);
      req.onerror = () => done(null);
      req.onblocked = () => done(null);
    } catch { done(null); }
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const countRecords = (data: DataMap) => Object.entries(data).filter(([k]) => !k.startsWith('_')).reduce((n, [, l]) => n + (Array.isArray(l) ? l.length : 0), 0);

let lastAt = 0;

/** Puts a full copy of one business's records aside. Returns false when the browser has no room or no IndexedDB. */
export async function saveCopy(workspace: string, reason: CopyReason, data: DataMap, counters: Record<string, number>, format = DATA_FORMAT): Promise<SafetyCopyInfo | null> {
  const db = await openDb();
  if (!db) return null;
  // Strictly later than the copy before, so "newest first" is always right even for two copies in one millisecond.
  lastAt = Math.max(Date.now(), lastAt + 1);
  const at = new Date(lastAt).toISOString();
  const copy: SafetyCopy = { id: `${workspace}:${at}:${Math.random().toString(36).slice(2, 7)}`, workspace, at, reason, appVersion: APP_VERSION, format, records: countRecords(data), data, counters };
  try {
    await both(db, (copies, infos) => { copies.put(copy); infos.put(info(copy)); });
    await prune(db, workspace);
    return info(copy);
  } catch { return null; } finally { db.close(); }
}

const info = ({ data: _d, counters: _c, ...rest }: SafetyCopy): SafetyCopyInfo => rest;

/** One write over both stores (the copy and its line in the list), all or nothing. */
function both(db: IDBDatabase, fn: (copies: IDBObjectStore, infos: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORE, INFO], 'readwrite');
    fn(t.objectStore(STORE), t.objectStore(INFO));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function allInfo(db: IDBDatabase): Promise<SafetyCopyInfo[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(INFO, 'readonly').objectStore(INFO).getAll();
    req.onsuccess = () => resolve((req.result as SafetyCopyInfo[]) || []);
    req.onerror = () => reject(req.error);
  });
}

async function prune(db: IDBDatabase, workspace: string) {
  const mine = (await allInfo(db)).filter((c) => c.workspace === workspace).sort((a, b) => b.at.localeCompare(a.at));
  const newestOfKind = new Set<string>();
  const keep = new Set<string>();
  for (const c of mine) if (!newestOfKind.has(c.reason)) { newestOfKind.add(c.reason); keep.add(c.id); }
  for (const c of mine) if (keep.size < KEEP) keep.add(c.id);
  const drop = mine.filter((c) => !keep.has(c.id));
  if (drop.length) await both(db, (copies, infos) => { for (const c of drop) { copies.delete(c.id); infos.delete(c.id); } });
}

/** Newest first. */
export async function listCopies(workspace: string): Promise<SafetyCopyInfo[]> {
  const db = await openDb();
  if (!db) return [];
  try { return (await allInfo(db)).filter((c) => c.workspace === workspace).sort((a, b) => b.at.localeCompare(a.at)); }
  catch { return []; } finally { db.close(); }
}

export async function getCopy(id: string): Promise<SafetyCopy | null> {
  const db = await openDb();
  if (!db) return null;
  try { return (await tx<SafetyCopy>(db, 'readonly', (s) => s.get(id) as IDBRequest<SafetyCopy>)) || null; }
  catch { return null; } finally { db.close(); }
}

export async function deleteCopy(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try { await both(db, (copies, infos) => { copies.delete(id); infos.delete(id); }); } finally { db.close(); }
}

/** Whether the browser promised not to clear this site's storage on its own (best effort, asked at start). */
export async function storageProtected(): Promise<boolean | null> {
  try { return (await navigator.storage?.persisted?.()) ?? null; } catch { return null; }
}
