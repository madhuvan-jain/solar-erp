// Device mode: attachments live in the browser's IndexedDB (room for hundreds of MB), not next to the
// records in localStorage (about 5 MB for everything). Records keep only a small reference ({ local: id }).
// Files attached by older versions (embedded as data: URLs) keep working unchanged.
const DB = 'ss1-files';
const STORE = 'files';

interface Stored { id: string; type: string; bytes: ArrayBuffer }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser cannot store files.')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage is full.'));
    });
  } finally { db.close(); }
}

export async function putFile(id: string, type: string, bytes: ArrayBuffer): Promise<void> {
  await run('readwrite', (s) => s.put({ id, type, bytes } satisfies Stored));
}

export async function getFile(id: string): Promise<{ type: string; bytes: ArrayBuffer } | null> {
  const v = await run<Stored | undefined>('readonly', (s) => s.get(id) as IDBRequest<Stored | undefined>);
  return v ? { type: v.type, bytes: v.bytes } : null;
}

export function bytesToDataUrl(type: string, bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  const safeType = /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream';
  return `data:${safeType};base64,${btoa(bin)}`;
}

export function dataUrlToBytes(url: string): { type: string; bytes: ArrayBuffer } | null {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m) return null;
  const bin = atob(m[2]);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return { type: m[1], bytes: u8.buffer };
}
