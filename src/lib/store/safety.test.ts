// A new app version must never lose or damage what people saved with an older one.
import { stored } from '../../test/records';
import { describe, expect, it } from 'vitest';
import { LocalBackend } from './local';
import { Store } from './store';
import { DATA_FORMAT, listCopies, migrate, MIGRATIONS } from './safety';
import type { Rec } from '../schema';

const NOW = '2025-01-10T10:00:00.000Z';
const rec = (id: string, extra: Record<string, unknown> = {}) => ({ id, createdAt: NOW, updatedAt: NOW, version: 1, ...extra });

/** What an older version left on the device: no data format recorded, plus fields and lists this app does not know. */
async function olderDevice() {
  const b0 = new LocalBackend();
  await b0.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
  localStorage.removeItem('ss1:format');
  localStorage.setItem('ss1:entities', JSON.stringify(['leads', 'futureThing']));
  localStorage.setItem('ss1:data:leads', JSON.stringify([rec('l1', { name: 'Ravi', phone: '+919876543210', someNewField: { a: 1 } }), null]));
  localStorage.setItem('ss1:data:futureThing', JSON.stringify([rec('f1', { x: 'kept' })]));
  localStorage.setItem('ss1:counters', JSON.stringify({ leads: 7 }));
}

async function signedIn(b: LocalBackend) {
  const s = new Store(b);
  s.user = (await b.currentUser())!;
  await s.load();
  return s;
}

describe('data safety across app versions (device mode)', () => {
  it('upgrades older data once, after a full safety copy, keeping every record and unknown field', async () => {
    await olderDevice();
    const b = new LocalBackend();
    await b.prepare();
    expect(JSON.parse(localStorage.getItem('ss1:format')!)).toBe(DATA_FORMAT);
    const data = await b.loadAll();
    expect(data.leads).toEqual([rec('l1', { name: 'Ravi', phone: '+919876543210', someNewField: { a: 1 } })]); // only the empty slot went
    expect(data.futureThing).toEqual([rec('f1', { x: 'kept' })]);
    // The lists moved out of localStorage (about 5 MB in all) into the device's record store, and only then left it.
    expect(localStorage.getItem('ss1:data:leads')).toBeNull();
    expect((await stored('leads')).map((r) => r.id)).toEqual(['l1']);
    const copies = await listCopies('main');
    expect(copies.map((c) => c.reason)).toEqual(['before-update']);
    expect(copies[0].format).toBe(1);

    // Starting again does not upgrade again or make another copy the same day.
    await new LocalBackend().prepare();
    expect((await listCopies('main')).length).toBe(1);
  });

  it('editing keeps fields this version does not know about', async () => {
    await olderDevice();
    const b = new LocalBackend();
    await b.prepare();
    const s = await signedIn(b);
    await s.update('leads', 'l1', { city: 'Patna' });
    const saved = (await stored('leads'))[0];
    expect(saved).toMatchObject({ city: 'Patna', someNewField: { a: 1 } });
  });

  it('data saved by a newer version is opened read-only and never changed', async () => {
    await olderDevice();
    localStorage.setItem('ss1:format', JSON.stringify(DATA_FORMAT + 1));
    const before = JSON.stringify(await stored('leads'));
    const b = new LocalBackend();
    await b.prepare();
    expect(b.health().blocked).toMatch(/newer version/);
    const s = await signedIn(b);
    expect(s.all('leads').map((r) => r.id)).toEqual(['l1']); // still readable
    await expect(s.create('leads', { name: 'New', phone: '9000000001' })).rejects.toThrow(/newer version/);
    await expect(s.replaceAll({})).rejects.toThrow(/newer version/);
    expect(JSON.stringify(await stored('leads'))).toBe(before);
  });

  it('a list that cannot be read is never overwritten', async () => {
    const b0 = new LocalBackend();
    const { user } = await b0.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    localStorage.setItem('ss1:entities', JSON.stringify(['_settings', 'leads']));
    localStorage.setItem('ss1:data:leads', '[{"id":"l1", BROKEN');
    const b = new LocalBackend();
    await b.prepare();
    const s = new Store(b);
    s.user = user;
    await s.load();
    expect(b.health().damaged).toEqual(['leads']);
    await expect(s.create('leads', { name: 'New', phone: '9000000001' })).rejects.toThrow(/could not be read/);
    expect(localStorage.getItem('ss1:data:leads')).toBe('[{"id":"l1", BROKEN');
  });

  it('a restore or demo load can be undone from the safety copy made just before it', async () => {
    const b = new LocalBackend();
    await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    await b.prepare();
    const s = await signedIn(b);
    const lead = await s.create('leads', { name: 'Mine', phone: '9000000001' });
    await s.replaceAll({ leads: [] });
    expect(s.all('leads')).toHaveLength(0);
    const copy = (await b.listSafetyCopies()).find((c) => c.reason === 'before-restore')!;
    expect(copy.records).toBeGreaterThan(0);
    await b.restoreSafetyCopy(copy.id);
    await s.reload();
    expect(s.get('leads', lead.id)?.name).toBe('Mine');
    // ...and what was replaced by that is itself kept, so this can be undone too.
    expect((await b.listSafetyCopies()).filter((c) => c.reason === 'before-restore')).toHaveLength(2);
  });

  it('takes a daily safety copy and a manual one on request', async () => {
    const b = new LocalBackend();
    await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    const s = await signedIn(b);
    await s.create('leads', { name: 'A', phone: '9000000001' });
    await new LocalBackend().prepare();
    expect((await listCopies('main')).map((c) => c.reason)).toEqual(['daily']);
    await b.makeSafetyCopy();
    expect((await listCopies('main')).map((c) => c.reason)).toEqual(['manual', 'daily']);
  });

  it('every migration keeps records and gives the same result when run twice', () => {
    const data = { leads: [rec('a', { name: 'x' }) as Rec, rec('b') as Rec], other: [rec('c', { y: [1, 2] }) as Rec] };
    const once = migrate(data, 1);
    expect(migrate(once, 1)).toEqual(once);
    for (const m of MIGRATIONS) {
      const out = m.run(data);
      for (const [k, list] of Object.entries(data)) expect(out[k].map((r) => r.id)).toEqual(list.map((r) => r.id));
    }
    expect(MIGRATIONS.at(-1)!.to).toBe(DATA_FORMAT);
  });

  it('safety copies made by the previous version are still listed and restorable after the update', async () => {
    // As version 1 stored them: one store, full copies only.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('ss1-safety', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('copies', { keyPath: 'id' });
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction('copies', 'readwrite');
        t.objectStore('copies').put({ id: 'main:old', workspace: 'main', at: '2026-01-01T00:00:00.000Z', reason: 'daily', appVersion: '1.0.0', format: 2, records: 1, data: { leads: [rec('l9', { name: 'Old' })] }, counters: {} });
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });
    const list = await listCopies('main');
    expect(list.map((c) => c.id)).toEqual(['main:old']);
    expect(list[0]).not.toHaveProperty('data');
    const { getCopy } = await import('./safety');
    expect((await getCopy('main:old'))?.data.leads[0].name).toBe('Old');
  });
});
