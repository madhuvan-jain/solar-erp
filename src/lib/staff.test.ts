import { describe, expect, it } from 'vitest';
import { LocalBackend } from './store/local';
import { Store } from './store/store';
import { remapStaff, restoreStaff, staffForBackup, staffFromBackup, staffIdMap } from './staff';

describe('staff in backups', () => {
  it('a backup restored on a new device brings the staff back (no passwords) and their records stay theirs', async () => {
    // Old device: admin + a sales person with "own leads only", who created a lead.
    localStorage.clear();
    const oldB = new LocalBackend();
    const { user: admin } = await oldB.setupAdmin('Owner', 'owner@biz.in', 'password123', '9876543210');
    await oldB.saveUser({ id: 'sales-1', name: 'Priya', email: 'priya@biz.in', phone: '9876500001', role: 'sales', active: true, access: { crm: 'own' } }, 'secret123');
    const oldS = new Store(oldB); oldS.user = admin; await oldS.load();
    await oldS.refreshUsers();
    oldS.user = { ...oldS.users.find((u) => u.id === 'sales-1')! };
    const lead = await oldS.create('leads', { name: 'Rooftop lead', phone: '9000000201', assignedTo: 'sales-1' });
    expect(lead.createdBy).toBe('sales-1');
    const staff = staffForBackup(oldS.users);
    expect(JSON.stringify(staff)).not.toMatch(/hash|salt|password/i);
    const data = oldS.exportAll();

    // New device: the owner sets up again (a new id for the same email), then restores.
    localStorage.clear();
    const b = new LocalBackend();
    const { user: me } = await b.setupAdmin('Owner', 'owner@biz.in', 'password123', '9876543210');
    const s = new Store(b); s.user = me; await s.load();
    const fromFile = staffFromBackup(JSON.parse(JSON.stringify(staff)));
    const restored = remapStaff(data, staffIdMap(fromFile, s.users));
    await s.replaceAll(restored);
    const res = await restoreStaff(b, fromFile, s.users);
    await s.refreshUsers();
    expect(res).toEqual({ added: 1, skipped: [] });
    expect(s.users.find((u) => u.id === 'sales-1')).toMatchObject({ name: 'Priya', role: 'sales', access: { crm: 'own' } });
    // The owner's own old records now point at the owner's new account.
    expect(s.all('leads')[0]).toMatchObject({ createdBy: 'sales-1', assignedTo: 'sales-1' });
    const ownerOld = data.leads[0];
    expect(ownerOld.createdBy).toBe('sales-1');
    // Nobody can sign in as Priya until the admin sets a password.
    await expect(b.signIn('priya@biz.in', 'secret123')).rejects.toThrow();
  });

  it('records made by the owner on the old device point at the owner on the new one', () => {
    const map = staffIdMap([{ id: 'old-owner', name: 'Owner', email: 'Owner@Biz.in', role: 'admin', active: true }], [{ id: 'new-owner', name: 'Owner', email: 'owner@biz.in', role: 'admin', active: true }]);
    expect(map).toEqual({ 'old-owner': 'new-owner' });
    const out = remapStaff({ leads: [{ id: 'l1', createdAt: '', updatedAt: '', createdBy: 'old-owner', assignedTo: 'old-owner' }], _settings: [{ id: 's', createdAt: '', updatedAt: '', defaultSurveyor: 'old-owner' }] }, map);
    expect(out.leads[0]).toMatchObject({ createdBy: 'new-owner', assignedTo: 'new-owner' });
    expect(out._settings[0].defaultSurveyor).toBe('new-owner');
  });

  it('ignores malformed staff entries from a file', () => {
    expect(staffFromBackup([{ id: 'x', name: 'A', email: 'a@b.c', role: 'superuser' }, null, 'junk', { id: 'y', name: 'B', email: 'b@b.c', role: 'sales' }]).map((u) => u.id)).toEqual(['y']);
    expect(staffFromBackup('nope')).toEqual([]);
  });
});
