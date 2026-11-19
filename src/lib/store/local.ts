import type { Rec } from '../schema';
import { uid } from '../format';
import { toMobile } from '../validate';
import { isValidLevel } from '../rbac';
import { AppError, ConflictError, MIN_PASSWORD, type AppUser, type Backend, type DataMap, type FileRef, type MobileStatus, type Numbering, type RemoteChange, type ReplaceOptions } from './types';
import { MAIN, ROOT, currentWorkspace, prefixOf, useWorkspace, workspacePrefix } from './workspace';
import { bytesToDataUrl, dataUrlToBytes, getFile, putFile } from './fileStore';
import { UnreadableList, changeList, getList, removeLists, setList } from './recordStore';
import { DATA_FORMAT, getCopy, listCopies, migrate, newerDataMessage, saveCopy, type CopyReason, type SafetyCopyInfo } from './safety';

interface Workspace { id: string; name: string; createdAt: string }
interface Session { w: string; u: string }

const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Keys of the business currently in use (users, records, numbering, recovery code). */
const wp = () => workspacePrefix();

function readKey<T>(fullKey: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(fullKey);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
const read = <T,>(key: string, fallback: T): T => readKey(wp() + key, fallback);
/** Device-wide keys: which businesses exist and who is signed in. */
const readRoot = <T,>(key: string, fallback: T): T => readKey(ROOT + key, fallback);

function write(key: string, value: unknown, prefix = wp()) {
  try {
    localStorage.setItem(prefix + key, JSON.stringify(value));
  } catch (e) {
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
    throw new AppError(quota
      ? 'Device storage is full. Remove large attachments or switch to cloud mode.'
      : 'Could not save on this device. Check that browser storage is allowed.');
  }
}

interface StoredUser extends AppUser { salt: string; hash: string }

async function hashPassword(password: string, salt: string): Promise<string> {
  // PBKDF2 makes guessing passwords from a copied browser profile slow.
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100_000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function publicUser(u: StoredUser): AppUser {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
    ...(u.phone ? { phone: u.phone } : {}), ...(u.access && Object.keys(u.access).length ? { access: { ...u.access } } : {}),
  };
}

function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return chars.match(/.{5}/g)!.join('-');
}

/** Highest sequence per counter key, so numbering continues correctly after a restore. */
export function countersFrom(data: DataMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [entity, list] of Object.entries(data)) {
    for (const r of list) {
      const key = typeof r._numKey === 'string' ? r._numKey : entity;
      const seq = Number(r._seq ?? String(r.number || '').split(/[-/]/).pop());
      if (Number.isFinite(seq) && seq > (out[key] || 0)) out[key] = seq;
    }
  }
  return out;
}

/**
 * Device mode: data lives in this browser only. Login protects the screen,
 * not the data — anyone with access to the device's browser profile could read it.
 */
export class LocalBackend implements Backend {
  mode = 'local' as const;
  /** Set when the data on this device was saved by a newer app: everything stays read-only. */
  private blockedBy = new Map<string, string>(); // business id → why it is read-only
  /** Record lists that could not be read: they are never overwritten. */
  private damagedBy = new Map<string, Set<string>>(); // business id → lists that could not be read
  private get blocked(): string | null { return this.blockedBy.get(currentWorkspace()) ?? null; }
  private get damaged(): Set<string> {
    const w = currentWorkspace();
    if (!this.damagedBy.has(w)) this.damagedBy.set(w, new Set());
    return this.damagedBy.get(w)!;
  }

  /** Who this tab signed in as. Another tab signing in to another business (or as someone else) must never make
   *  this tab write there: this tab then counts as signed out and reloads. */
  private mine: Session | null = null;

  constructor() {
    // Pick up the business of whoever is signed in on this device.
    this.mine = this.session();
    useWorkspace(this.mine?.w || MAIN);
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key !== ROOT + 'session' || !this.mine) return;
        const s = this.session();
        if (!s || s.w !== this.mine.w || s.u !== this.mine.u) location.reload();
      });
    }
  }

  // ---- businesses on this device ----
  /** Older sessions stored only the user id (always the first business). */
  private session(): Session | null {
    const s = readRoot<Session | string | null>('session', null);
    if (!s) return null;
    return typeof s === 'string' ? { w: MAIN, u: s } : s;
  }
  private setSession(w: string, u: string) { write('session', { w, u }, ROOT); this.mine = { w, u }; useWorkspace(w); }

  private workspaces(): Workspace[] {
    const extra = readRoot<Workspace[]>('workspaces', []);
    const hasMain = readKey<StoredUser[]>(prefixOf(MAIN) + 'users', []).length > 0;
    return [...(hasMain ? [{ id: MAIN, name: '', createdAt: '' }] : []), ...extra.filter((w) => w.id !== MAIN)];
  }
  private usersOf(w: string): StoredUser[] { return readKey<StoredUser[]>(prefixOf(w) + 'users', []); }
  /** Where a login lives: emails are unique across every business on this device. */
  private findLogin(match: (u: StoredUser) => boolean): { w: string; u: StoredUser }[] {
    return this.workspaces().flatMap((ws) => this.usersOf(ws.id).filter(match).map((u) => ({ w: ws.id, u })));
  }

  private entityKeys(): string[] {
    return read<string[]>('entities', []);
  }

  private unreadable(entity: string, prefix: string): never {
    if (prefix === wp()) this.damaged.add(entity);
    throw new AppError(`The saved ${entity} on this device could not be read, so nothing was changed. Restore a safety copy in Settings → Backup & data.`);
  }

  /**
   * One record list, read strictly. A list that cannot be read is NEVER replaced: saving into it would
   * throw the old records away, so the change is refused instead.
   */
  private async list(entity: string, prefix = wp()): Promise<Rec[]> {
    try { return (await getList(prefix + 'data:' + entity)) || []; }
    catch (e) { if (e instanceof UnreadableList) this.unreadable(entity, prefix); throw e; }
  }

  /** Refuses every change while the data belongs to a newer app version. */
  private guard() {
    if (this.blocked) throw new AppError(this.blocked);
  }

  async loadAll(): Promise<DataMap> {
    const out: DataMap = {};
    for (const k of this.entityKeys()) {
      // Entries that are not records (an empty slot) are skipped on screen; the stored list is left as it is.
      try { out[k] = (await this.list(k)).filter((r) => !!r && typeof r === 'object' && typeof r.id === 'string'); }
      catch { /* listed in health(); left untouched on the device */ }
    }
    return out;
  }

  /** One change to one list, as a single transaction (never a stale copy written over another tab's change). */
  private async change<T>(entity: string, fn: (list: Rec[]) => { list: Rec[]; result: T }): Promise<T> {
    this.guard();
    if (this.damaged.has(entity)) throw new AppError(`The saved ${entity} on this device could not be read, so nothing was changed.`);
    if (read<number | null>('format', null) === null) write('format', DATA_FORMAT);
    let result: T;
    try { result = await changeList(wp() + 'data:' + entity, fn); }
    catch (e) {
      if (e instanceof UnreadableList) this.unreadable(entity, wp());
      if (e instanceof AppError || e instanceof ConflictError) throw e;
      throw new AppError(/quota|full/i.test(String((e as Error)?.message || e)) ? 'Device storage is full. Remove large attachments or switch to cloud mode.' : 'Could not save on this device. Check that browser storage is allowed.');
    }
    const keys = this.entityKeys();
    if (!keys.includes(entity)) write('entities', [...keys, entity]);
    this.announce(entity);
    return result;
  }

  /** Tells other open tabs of this app that a list changed (they reload it). */
  private announce(entity: string) {
    try { localStorage.setItem(wp() + 'changed', `${Date.now()}:${entity}:${Math.random().toString(36).slice(2, 6)}`); } catch { /* best effort */ }
  }

  // ---- keeping data safe across app updates (see safety.ts) ----

  /**
   * Runs once at start, before anything is read: asks the browser to keep the data, upgrades each business
   * saved in an older format (after a safety copy), refuses to touch data from a newer app, and takes the
   * daily safety copy.
   */
  async prepare(): Promise<void> {
    // Asked, never awaited: some browsers (Firefox) wait for the person to answer a prompt.
    try { void navigator.storage?.persist?.()?.catch?.(() => {}); } catch { /* not supported */ }
    for (const ws of this.workspaces()) await this.prepareWorkspace(ws.id);
  }

  private async prepareWorkspace(id: string) {
    const prefix = prefixOf(id);
    const entities = readKey<string[]>(prefix + 'entities', []);
    const stored = readKey<number | null>(prefix + 'format', null);
    if (!entities.length) { if (stored === null) write('format', DATA_FORMAT, prefix); return; }
    const format = stored ?? 1; // data from before formats were recorded
    if (format > DATA_FORMAT) {
      this.blockedBy.set(id, newerDataMessage(format));
      return;
    }
    const data: DataMap = {};
    for (const k of entities) {
      try { data[k] = await this.list(k, prefix); } catch {
        if (!this.damagedBy.has(id)) this.damagedBy.set(id, new Set());
        this.damagedBy.get(id)!.add(k);
      }
    }
    const counters = readKey<Record<string, number>>(prefix + 'counters', {});
    if (format < DATA_FORMAT) {
      const damaged = entities.some((k) => !(k in data));
      // A copy of exactly what was there goes aside first. Damaged lists are left alone and not upgraded.
      await saveCopy(id, 'before-update', data, counters, format);
      if (damaged) return;
      const next = migrate(data, format);
      for (const [k, list] of Object.entries(next)) await setList(prefix + 'data:' + k, list);
      write('format', DATA_FORMAT, prefix);
      return;
    }
    const last = (await listCopies(id))[0];
    if (!last || Date.now() - Date.parse(last.at) > 20 * 3600_000) await saveCopy(id, 'daily', data, counters);
  }

  health() {
    return { blocked: this.blocked, damaged: [...this.damaged] };
  }

  async listSafetyCopies(): Promise<SafetyCopyInfo[]> {
    return listCopies(currentWorkspace());
  }

  async makeSafetyCopy(reason: CopyReason = 'manual'): Promise<SafetyCopyInfo> {
    const copy = await saveCopy(currentWorkspace(), reason, await this.loadAll(), read('counters', {}));
    if (!copy) throw new AppError('This browser has no room for a safety copy. Download a backup instead.');
    return copy;
  }

  /** Puts a safety copy back (the current data is copied aside first, so this can be undone too). */
  async restoreSafetyCopy(id: string, opts?: { keepCounters?: boolean }): Promise<void> {
    const copy = await getCopy(id);
    if (!copy || copy.workspace !== currentWorkspace()) throw new AppError('That safety copy no longer exists.');
    if (copy.format > DATA_FORMAT) throw new AppError(newerDataMessage(copy.format));
    await this.replaceAll(migrate(copy.data, copy.format), { counters: copy.counters, keepCounters: opts?.keepCounters ?? true });
  }

  async insert(entity: string, rec: Rec, numbering?: Numbering): Promise<Rec> {
    let counters: Record<string, number> = {};
    const saved = await this.change(entity, (list) => {
      if (list.some((r) => r.id === rec.id)) throw new AppError('This record was already saved.');
      counters = read<Record<string, number>>('counters', {});
      let out: Rec = { ...rec, version: 1 };
      if (numbering) {
        // Never trust the counter alone: if it failed to save last time, existing numbers still win.
        const highest = list.reduce((m, r) => (r._numKey === numbering.key && Number(r._seq) > m ? Number(r._seq) : m), 0);
        const n = Math.max(counters[numbering.key] || 0, highest) + 1;
        out = { ...out, number: `${numbering.prefix}${String(n).padStart(4, '0')}`, _numKey: numbering.key, _seq: n };
        counters[numbering.key] = n;
      }
      return { list: [...list, out], result: out };
    });
    // Counter is only advanced once the record is safely stored, so a failed save never leaves a gap.
    if (numbering) write('counters', counters);
    return saved;
  }

  async update(entity: string, rec: Rec, numbering?: Numbering): Promise<Rec> {
    let counters: Record<string, number> | null = null;
    const out = await this.change(entity, (list) => {
      const i = list.findIndex((r) => r.id === rec.id);
      if (i < 0) throw new AppError('This record no longer exists. It may have been deleted.');
      if ((list[i].version ?? 1) !== (rec.version ?? 1)) throw new ConflictError();
      const saved: Rec = { ...rec, number: list[i].number, _numKey: list[i]._numKey, _seq: list[i]._seq, version: (rec.version ?? 1) + 1, updatedAt: new Date().toISOString() };
      if (saved.number === undefined) delete saved.number;
      if (saved._numKey === undefined) { delete saved._numKey; delete saved._seq; }
      if (numbering && !list[i].number) {
        // Issued now: the next number in the series (a draft that is never issued uses none).
        counters = read<Record<string, number>>('counters', {});
        const highest = list.reduce((m, r) => (r._numKey === numbering.key && Number(r._seq) > m ? Number(r._seq) : m), 0);
        const n = Math.max(counters[numbering.key] || 0, highest) + 1;
        Object.assign(saved, { number: `${numbering.prefix}${String(n).padStart(4, '0')}`, _numKey: numbering.key, _seq: n });
        counters[numbering.key] = n;
      }
      const next = list.slice();
      next[i] = saved;
      return { list: next, result: saved };
    });
    if (counters) write('counters', counters);
    return out;
  }

  async remove(entity: string, id: string): Promise<void> {
    await this.change(entity, (list) => ({ list: list.filter((r) => r.id !== id), result: undefined }));
  }

  /**
   * Replaces all records. Numbering never goes back: each counter is the highest of what the records show, the
   * counters given (from a backup) and — unless `keepCounters` is false (demo data in or out) — the current ones,
   * so a number already given to a customer is never issued again after a restore.
   */
  async replaceAll(data: DataMap, opts: ReplaceOptions = {}): Promise<void> {
    this.guard();
    if (this.damaged.size) throw new AppError('Some saved data on this device could not be read. Download a backup of it first, then contact support.');
    const previous = { entities: this.entityKeys(), data: await this.loadAll(), counters: read<Record<string, number>>('counters', {}) };
    // What is replaced goes aside first, so a wrong restore or the demo data can be undone.
    if (previous.entities.length) await saveCopy(currentWorkspace(), 'before-restore', previous.data, previous.counters);
    try {
      for (const k of previous.entities) if (!(k in data)) await setList(wp() + 'data:' + k, null);
      for (const [k, list] of Object.entries(data)) await setList(wp() + 'data:' + k, list);
      write('entities', Object.keys(data));
      const next = { ...countersFrom(data) };
      for (const src of [opts.keepCounters === false ? {} : previous.counters, opts.counters || {}]) {
        for (const [k, v] of Object.entries(src)) if (Number(v) > (next[k] || 0)) next[k] = Number(v);
      }
      write('counters', next);
      write('format', DATA_FORMAT);
      this.announce('*');
    } catch (e) {
      // Put the old data back so a failed restore (e.g. storage full) does not wipe everything.
      try {
        for (const k of Object.keys(data)) if (!(k in previous.data)) await setList(wp() + 'data:' + k, null);
        for (const [k, list] of Object.entries(previous.data)) await setList(wp() + 'data:' + k, list);
        localStorage.setItem(wp() + 'entities', JSON.stringify(previous.entities));
        localStorage.setItem(wp() + 'counters', JSON.stringify(previous.counters));
      } catch { /* the safety copy made above still has it */ }
      throw e instanceof AppError ? e : new AppError('Could not restore on this device (storage full?). Nothing was lost: the data before is in Settings → Backup & data → safety copies.');
    }
  }

  private users(): StoredUser[] {
    return read<StoredUser[]>('users', []);
  }

  async currentUser(): Promise<AppUser | null> {
    const s = this.session();
    if (!s) return null;
    if (this.mine && (s.w !== this.mine.w || s.u !== this.mine.u)) return null; // another tab signed in elsewhere
    this.mine = s;
    useWorkspace(s.w);
    const u = this.users().find((x) => x.id === s.u && x.active);
    return u ? publicUser(u) : null;
  }

  async needsSetup(): Promise<boolean> {
    return this.workspaces().length === 0;
  }

  async setupAdmin(name: string, email: string, password: string, phone: string) {
    if (!(await this.needsSetup())) throw new AppError('Setup is already complete. Please sign in.');
    const mobile = toMobile(phone);
    if (!mobile) throw new AppError('Enter a valid 10-digit Indian mobile number.');
    const u = await this.makeUser({ id: uid(), name, email, role: 'admin', active: true, phone: mobile }, password);
    const recoveryCode = newRecoveryCode();
    useWorkspace(MAIN);
    write('users', [u]);
    write('format', DATA_FORMAT);
    write('recovery', await hashPassword(recoveryCode, 'recovery'));
    this.setSession(MAIN, u.id);
    return { user: publicUser(u), recoveryCode };
  }

  /**
   * "Create account": a brand-new, empty business on this device with the person as its admin.
   * It shares nothing with the other businesses here. Staff of an existing business are added by its admin.
   */
  async createBusiness(name: string, company: string, email: string, password: string, phone: string) {
    if (await this.needsSetup()) return this.setupAdmin(name, email, password, phone);
    const clean = email.trim().toLowerCase();
    if (!name.trim()) throw new AppError('Enter your name.');
    if (!company.trim()) throw new AppError('Enter the business name.');
    if (this.findLogin((u) => u.email === clean).length) throw new AppError('This email already has an account on this device. Please sign in, or use another email.');
    const mobile = toMobile(phone);
    if (!mobile) throw new AppError('Enter a valid 10-digit Indian mobile number.');
    const u = await this.makeUser({ id: uid(), name: name.trim(), email: clean, role: 'admin', active: true, phone: mobile }, password);
    const id = uid();
    const recoveryCode = newRecoveryCode();
    const prefix = prefixOf(id);
    const now = new Date().toISOString();
    write('users', [u], prefix);
    write('recovery', await hashPassword(recoveryCode, 'recovery'), prefix);
    // The business name goes on its documents straight away.
    await setList(prefix + 'data:_settings', [{ id: uid(), createdAt: now, updatedAt: now, version: 1, companyName: company.trim() } as Rec]);
    write('entities', ['_settings'], prefix);
    write('format', DATA_FORMAT, prefix);
    write('workspaces', [...readRoot<Workspace[]>('workspaces', []), { id, name: company.trim(), createdAt: now }], ROOT);
    this.setSession(id, u.id);
    return { user: publicUser(u), recoveryCode };
  }

  private async makeUser(user: AppUser, password: string): Promise<StoredUser> {
    if (password.length < MIN_PASSWORD) throw new AppError(`Password must be at least ${MIN_PASSWORD} characters.`);
    const salt = uid();
    return { ...user, email: user.email.trim().toLowerCase(), salt, hash: await hashPassword(password, salt) };
  }

  async signIn(email: string, password: string): Promise<AppUser> {
    const clean = email.trim().toLowerCase();
    let hit: { w: string; u: StoredUser } | undefined;
    for (const c of this.findLogin((x) => x.email === clean)) {
      if ((await hashPassword(password, c.u.salt)) === c.u.hash) { hit = c; break; }
    }
    if (!hit) throw new AppError('Wrong email or password.');
    if (!hit.u.active) throw new AppError('This account has been disabled. Contact your administrator.');
    this.setSession(hit.w, hit.u.id);
    return publicUser(hit.u);
  }

  /** Device mode: "Create account" makes a separate new business (see createBusiness). */
  async signUp(name: string, email: string, password: string, phone: string): Promise<AppUser | null> {
    return (await this.createBusiness(name, `${name.trim()}'s business`, email, password, phone)).user;
  }

  async signOut(): Promise<void> {
    localStorage.removeItem(ROOT + 'session');
    this.mine = null;
  }

  /** Document counters of this business (they go into backups, so a restore never hands out a number twice). */
  counters(): Record<string, number> {
    return read<Record<string, number>>('counters', {});
  }

  async listUsers(): Promise<AppUser[]> {
    return this.users().map(publicUser);
  }

  /** The admin adds and changes anyone; everyone else may change only their own name, number and password. */
  async saveUser(user: AppUser, password?: string): Promise<AppUser> {
    const me = await this.currentUser();
    if (me?.role !== 'admin') {
      const old = this.users().find((u) => u.id === user.id);
      const same = (a: unknown, b: unknown) => JSON.stringify(a || {}) === JSON.stringify(b || {});
      if (!me || !old || me.id !== user.id || old.role !== user.role || old.active !== user.active
        || old.email !== user.email.trim().toLowerCase() || !same(old.access, user.access)) {
        throw new AppError('Only the admin can add users or change roles and access rights.');
      }
    }
    return this.writeUser(user, password);
  }

  private async writeUser(user: AppUser, password?: string): Promise<AppUser> {
    const users = this.users();
    const email = user.email.trim().toLowerCase();
    if (!user.name.trim()) throw new AppError('Name is required.');
    if (users.some((u) => u.email === email && u.id !== user.id)) throw new AppError('A user with this email already exists.');
    // A login belongs to one business only, so the same email cannot be added to two of them on this device.
    if (!users.some((u) => u.id === user.id) && this.findLogin((u) => u.email === email).length) {
      throw new AppError('This email already has an account in another business on this device. Use another email.');
    }
    const i = users.findIndex((u) => u.id === user.id);
    // Every new account needs a mobile number; an older account without one may still be edited.
    const mobile = user.phone ? toMobile(user.phone) : null;
    if (user.phone && !mobile) throw new AppError('Enter a valid 10-digit Indian mobile number.');
    if (!mobile && (i < 0 || users[i].phone)) throw new AppError('Mobile number is required.');
    if (mobile && users.some((u) => u.phone === mobile && u.id !== user.id)) throw new AppError('This mobile number is already used by another user.');
    // Only real levels for real apps; nothing for the admin, who always has everything.
    const access = Object.fromEntries(Object.entries(user.access || {}).filter(([m, l]) => isValidLevel(m, l)));
    user = { ...user, ...(mobile ? { phone: mobile } : {}), access: user.role === 'admin' ? {} : access };
    const next = users.slice();
    if (i < 0) {
      if (!password) throw new AppError('Set a password for the new user.');
      next.push(await this.makeUser({ ...user, email }, password));
    } else {
      const merged: StoredUser = { ...users[i], ...user, email };
      next[i] = password ? { ...(await this.makeUser(merged, password)), id: merged.id } : merged;
    }
    if (!next.some((u) => u.role === 'admin' && u.active)) throw new AppError('At least one active admin is required.');
    write('users', next);
    return publicUser(next.find((u) => u.id === user.id)!);
  }

  private removeUser(id: string) {
    const users = this.users();
    const next = users.filter((u) => u.id !== id);
    if (next.length === users.length) throw new AppError('This user no longer exists.');
    if (!next.some((u) => u.role === 'admin' && u.active)) {
      throw new AppError('At least one active admin is required. Make another user an admin first.');
    }
    write('users', next);
  }

  async deleteMyAccount(): Promise<void> {
    const me = await this.currentUser();
    if (!me) throw new AppError('Please sign in again.');
    const w = this.session()?.w || MAIN;
    // The only person in a business made with "Create account": the business goes with them.
    if (w !== MAIN && this.users().length === 1) {
      const prefix = prefixOf(w);
      for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k);
      await removeLists(prefix); // its records in the file store too
      write('workspaces', readRoot<Workspace[]>('workspaces', []).filter((x) => x.id !== w), ROOT);
    } else this.removeUser(me.id);
    localStorage.removeItem(ROOT + 'session');
    useWorkspace(MAIN);
  }

  async deleteUser(id: string): Promise<void> {
    const me = await this.currentUser();
    if (!me || me.role !== 'admin') throw new AppError('Only an admin can delete users.');
    if (id === me.id) throw new AppError('Use “Delete my account” to delete your own account.');
    this.removeUser(id);
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const me = await this.currentUser();
    if (!me) throw new AppError('Please sign in again.');
    const u = this.users().find((x) => x.id === me.id)!;
    if ((await hashPassword(oldPassword, u.salt)) !== u.hash) throw new AppError('Current password is wrong.');
    await this.saveUser(me, newPassword);
  }

  async requestPasswordReset(): Promise<void> {
    throw new AppError('In device mode, ask your admin to set a new password in Settings → Users & access. Admins can use their recovery code.');
  }

  async isPasswordRecovery(): Promise<boolean> {
    return false;
  }

  async setNewPassword(): Promise<void> {
    throw new AppError('Not available in device mode.');
  }

  /** Lets an admin who forgot their password back in with the code shown at setup. Issues a fresh code. */
  async recoverWithCode(who: string, code: string, newPassword: string) {
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{5})(?=.)/g, '$1-');
    const mobile = who.includes('@') ? null : toMobile(who);
    // Each business has its own recovery code: find the admin first, then check that business's code.
    const admins = this.findLogin((x) => x.role === 'admin' && (mobile ? x.phone === mobile : x.email === who.trim().toLowerCase()));
    if (!admins.length) throw new AppError(mobile ? 'No admin account has that mobile number.' : 'No admin account has that email or mobile number.');
    const hashed = await hashPassword(clean, 'recovery');
    const hit = admins.find((a) => readKey<string | null>(prefixOf(a.w) + 'recovery', null) === hashed);
    if (!hit) throw new AppError('That recovery code is not valid.');
    useWorkspace(hit.w);
    await this.writeUser({ ...publicUser(hit.u), active: true }, newPassword);
    const recoveryCode = newRecoveryCode();
    write('recovery', await hashPassword(recoveryCode, 'recovery'));
    this.setSession(hit.w, hit.u.id);
    return { user: { ...publicUser(hit.u), active: true }, recoveryCode };
  }

  // Device mode has no server, so no SMS can be sent: the number identifies the account and is kept for contact.
  readonly phoneOtp = false;

  async mobileStatus(user: AppUser): Promise<MobileStatus> {
    return this.users().find((u) => u.id === user.id)?.phone ? 'verified' : 'missing';
  }

  readonly identityCheck = 'password' as const;

  /** Adding a first number needs nothing more; changing one needs the current password (no email can be sent here). */
  async setMyPhone(phone: string, proof?: { password?: string }): Promise<void> {
    const me = await this.currentUser();
    if (!me) throw new AppError('Please sign in again.');
    const stored = this.users().find((u) => u.id === me.id)!;
    const changing = !!stored.phone && toMobile(phone) !== stored.phone;
    if (changing) {
      if (!proof?.password) throw new AppError('Enter your current password to change your mobile number.');
      if ((await hashPassword(proof.password, stored.salt)) !== stored.hash) throw new AppError('Current password is wrong.');
    }
    await this.saveUser({ ...me, phone });
  }

  async uploadFile(file: File): Promise<FileRef> {
    if (file.size > MAX_FILE_BYTES) {
      throw new AppError(`In device mode files must be under ${MAX_FILE_BYTES / 1024 / 1024} MB. Compress the file or use cloud mode.`);
    }
    this.guard();
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(new AppError('Could not read the file.'));
      r.readAsArrayBuffer(file);
    });
    // Named per business, so one business's files can never overwrite another's on a shared device.
    const id = `${currentWorkspace()}-${uid()}`;
    try { await putFile(id, file.type || 'application/octet-stream', bytes); }
    catch { throw new AppError('This device has no room left for files. Remove old files or use cloud mode.'); }
    return { name: file.name.slice(0, 200), size: file.size, type: file.type, local: id };
  }

  async fileUrl(ref: FileRef): Promise<string> {
    if (ref.dataUrl) return ref.dataUrl; // attached by an older version
    if (!ref.local) return '';
    const f = await getFile(ref.local);
    if (!f) throw new AppError('This file is no longer on this device. Restore it from a backup.');
    return bytesToDataUrl(f.type, f.bytes);
  }

  // Files are not deleted with their record: an older safety copy may still point to them.

  async exportFiles(refs: FileRef[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const r of refs) {
      if (!r?.local || out[r.local]) continue;
      const f = await getFile(r.local).catch(() => null);
      if (f) out[r.local] = bytesToDataUrl(f.type, f.bytes);
    }
    return out;
  }

  async importFiles(files: Record<string, string>): Promise<number> {
    let n = 0;
    for (const [id, url] of Object.entries(files)) {
      const f = dataUrlToBytes(url);
      if (!f || !/^[\w-]{6,100}$/.test(id)) continue;
      await putFile(id, f.type, f.bytes);
      n++;
    }
    return n;
  }

  /** Another browser tab on this device changed data. */
  onRemoteChange(cb: (c: RemoteChange) => void): () => void {
    const h = (e: StorageEvent) => { if (e.key?.startsWith(wp() + 'data:') || e.key === wp() + 'changed') cb({ kind: 'reload' }); };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  }
}
