// Where device mode keeps its record lists. Browser "localStorage" holds only about 5 MB for everything, which a
// solar business fills with a few thousand invoices; IndexedDB holds hundreds of MB. So each list (one per record
// type and business, key "<prefix>data:<entity>") lives in IndexedDB, and every change is one read-change-write
// transaction, so two open tabs can never overwrite each other's work.
//
// Lists saved by older versions in localStorage move over the first time they are read: copied, read back and
// compared, and only then removed from localStorage. A list that cannot be read is left exactly where it is.
// Browsers without IndexedDB keep using localStorage as before.
import type { Rec } from '../schema';

const DB = 'ss1-records';
const STORE = 'lists';

export class UnreadableList extends Error {}

// Set once this browser keeps its records in IndexedDB. From then on, failing to open it must never quietly fall back
// to the (now empty) old storage: the business would look empty and new work would be saved where it gets lost.
const IN_IDB = 'ss1-records:in-idb';
const inIdb = () => { try { return localStorage.getItem(IN_IDB) === '1'; } catch { return false; } };

let dbPromise: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    const p: Promise<IDBDatabase | null> = new Promise((resolve, reject) => {
      const failed = () => {
        dbPromise = null; // try again next time
        if (inIdb()) reject(new Error('This browser’s storage could not be opened right now. Close other tabs of the app and reload the page — nothing has been lost.'));
        else resolve(null);
      };
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => {
          const d = req.result;
          // Another tab upgrading the database later: let it, and reopen next time.
          d.onversionchange = () => { d.close(); dbPromise = null; };
          try { localStorage.setItem(IN_IDB, '1'); } catch { /* storage blocked: nothing to protect */ }
          resolve(d);
        };
        req.onerror = failed;
        req.onblocked = failed;
      } catch { failed(); }
    });
    dbPromise = p;
  }
  return dbPromise;
}

/** Forget the open connection (tests replace IndexedDB between runs). */
export function resetRecordStore() { dbPromise = null; }

function legacy(key: string): Rec[] | undefined {
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  try {
    const v = JSON.parse(raw);
    // Lists, and the few objects kept the same way (the data put aside while demo data is loaded).
    if (Array.isArray(v) || (v && typeof v === 'object')) return v as Rec[];
  } catch { /* fall through */ }
  throw new UnreadableList(key);
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

/** Moves one list from localStorage into IndexedDB (only after reading it back intact). */
async function moveOver(d: IDBDatabase, key: string): Promise<Rec[] | undefined> {
  const old = legacy(key); // throws UnreadableList for a damaged list: it stays where it is
  if (old === undefined) return undefined;
  const t = d.transaction(STORE, 'readwrite');
  const s = t.objectStore(STORE);
  const already = await req(s.get(key)) as Rec[] | undefined;
  if (already) return already; // another tab moved it meanwhile
  s.put(old, key);
  await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  const back = await req(d.transaction(STORE, 'readonly').objectStore(STORE).get(key)) as Rec[] | undefined;
  if (Array.isArray(back) && back.length === old.length) {
    try { localStorage.removeItem(key); } catch { /* harmless: IndexedDB has it now and wins */ }
  }
  return back || old;
}

/** One list; undefined when there is none. Throws UnreadableList for a damaged old list. */
export async function getList(key: string): Promise<Rec[] | undefined> {
  const d = await db();
  if (!d) return legacy(key);
  const v = await req(d.transaction(STORE, 'readonly').objectStore(STORE).get(key)) as Rec[] | undefined;
  if (v !== undefined) return v;
  return moveOver(d, key);
}

/**
 * Changes one list in a single transaction: `change` gets the current list and returns the new one (it must not
 * wait for anything). Throwing inside `change` leaves the list untouched.
 */
export async function changeList<T>(key: string, change: (list: Rec[]) => { list: Rec[]; result: T }): Promise<T> {
  const d = await db();
  if (!d) {
    const out = change(legacy(key) || []);
    writeLegacy(key, out.list);
    return out.result;
  }
  if ((await getList(key)) === undefined) { /* nothing to move first */ }
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    let result: T;
    let failed: unknown = null;
    const g = s.get(key);
    g.onsuccess = () => {
      try {
        const out = change((g.result as Rec[] | undefined) || []);
        result = out.result;
        s.put(out.list, key);
      } catch (e) { failed = e; t.abort(); }
    };
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(failed || t.error || new Error('Could not save on this device.'));
    t.onerror = () => { /* onabort follows */ };
  });
}

/** Replaces one list (or removes it with null). */
export async function setList(key: string, list: Rec[] | null): Promise<void> {
  const d = await db();
  if (!d) { if (list === null) localStorage.removeItem(key); else writeLegacy(key, list); return; }
  const t = d.transaction(STORE, 'readwrite');
  if (list === null) t.objectStore(STORE).delete(key); else t.objectStore(STORE).put(list, key);
  await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Storage is full.')); });
  if (list === null) { try { localStorage.removeItem(key); } catch { /* none */ } }
}

/** Removes every list whose key starts with `prefix` (a deleted business). */
export async function removeLists(prefix: string): Promise<void> {
  const d = await db();
  if (!d) return;
  const keys = await req(d.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys());
  const t = d.transaction(STORE, 'readwrite');
  for (const k of keys) if (String(k).startsWith(prefix)) t.objectStore(STORE).delete(k);
  await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

function writeLegacy(key: string, list: Rec[]) {
  try { localStorage.setItem(key, JSON.stringify(list)); }
  catch (e) {
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
    throw new Error(quota ? 'Device storage is full. Remove large attachments or switch to cloud mode.' : 'Could not save on this device. Check that browser storage is allowed.');
  }
}
