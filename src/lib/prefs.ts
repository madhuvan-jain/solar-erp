// Small personal preferences — the dashboard order and which alerts to show. They are read from this
// browser straight away, and in cloud mode also kept with the person's account, so the same choices
// follow them from a phone to a computer and back.
import type { Store } from './store';

/** Preference name → local key. Only these small values travel with the account. */
const KNOWN: Record<string, { local: (uid: string) => string; event: string }> = {
  defdash: { local: (uid) => `ss1:defdash:${uid}`, event: 'ss1-defdash' },
  alertprefs: { local: (uid) => `ss1:alertprefs:${uid}`, event: 'ss1-alertprefs' },
};

let sink: ((key: string, value: unknown) => void) | null = null;

const pendingKey = (uid: string) => `ss1:prefs-pending:${uid}`;
const readPending = (uid: string): string[] => { try { return JSON.parse(localStorage.getItem(pendingKey(uid)) || '[]'); } catch { return []; } };
const writePending = (uid: string, keys: string[]) => { try { localStorage.setItem(pendingKey(uid), JSON.stringify([...new Set(keys)])); } catch { /* blocked */ } };

/** Called by a page after saving a preference locally: also sends it to the account (cloud mode). */
export function pushPref(key: string, value: unknown): void {
  if (KNOWN[key]) sink?.(key, value);
}

/**
 * Connects the preferences to the signed-in account: brings in what was saved on other devices, then sends every
 * later change. A change that could not be sent (offline) is remembered and sent next time instead of being
 * overwritten by the older copy on the server. Changes go one after another, so the last one always wins.
 */
export function connectPrefs(store: Store): () => void {
  const b = store.backend, uid = store.user?.id;
  if (!uid || !b.loadPrefs || !b.savePref) return () => {};
  let live = true;
  let chain: Promise<void> = Promise.resolve();
  const send = (key: string, value: unknown) => {
    writePending(uid, [...readPending(uid), key]);
    chain = chain.then(() => b.savePref!(key, value)).then(
      () => { writePending(uid, readPending(uid).filter((k) => k !== key)); },
      () => { /* stays pending; sent again on the next change or sign-in */ },
    );
  };
  sink = send;
  b.loadPrefs().then((all) => {
    if (!live) return;
    const pending = readPending(uid);
    for (const [key, k] of Object.entries(KNOWN)) {
      if (pending.includes(key)) {
        // This device has a newer choice the server never got: send it.
        try { const v = JSON.parse(localStorage.getItem(k.local(uid)) || 'null'); if (v !== null) send(key, v); } catch { /* unreadable: leave it */ }
        continue;
      }
      if (!(key in all)) continue;
      try { localStorage.setItem(k.local(uid), JSON.stringify(all[key])); } catch { /* blocked storage */ }
      window.dispatchEvent(new Event(k.event));
    }
  }).catch(() => { /* offline: this device's choices stay */ });
  return () => { live = false; if (sink === send) sink = null; };
}
