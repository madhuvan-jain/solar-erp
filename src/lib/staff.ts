// Staff accounts in device-mode backups: who they are and what they may do (name, email, mobile, role, access
// rights) — never their passwords. Restoring onto another device adds the people who are not there yet; they sign in
// once the admin sets a password for them under Users. Records keep pointing at the right person throughout.
import { ENTITIES } from '../modules/registry';
import type { DataMap } from './store';
import type { AppUser, Backend, Role } from './store/types';

export type BackupStaff = Pick<AppUser, 'id' | 'name' | 'email' | 'role' | 'active' | 'phone' | 'access'>;

const ROLES: Role[] = ['admin', 'manager', 'sales', 'technician', 'accounts'];

export function staffForBackup(users: AppUser[]): BackupStaff[] {
  return users.map(({ id, name, email, role, active, phone, access }) => ({
    id, name, email, role, active, ...(phone ? { phone } : {}), ...(access && Object.keys(access).length ? { access } : {}),
  }));
}

/** Only well-formed entries from a backup file (it may be old or edited by hand). */
export function staffFromBackup(v: unknown): BackupStaff[] {
  if (!Array.isArray(v)) return [];
  return v.filter((u): u is BackupStaff => !!u && typeof u === 'object'
    && typeof u.id === 'string' && /^[\w-]{1,80}$/.test(u.id) && typeof u.name === 'string' && typeof u.email === 'string'
    && ROLES.includes(u.role));
}

/** Backup ids → this device's ids for the same people (same email, made separately on each device). */
export function staffIdMap(backup: BackupStaff[], here: AppUser[]): Record<string, string> {
  const byEmail = new Map(here.map((u) => [u.email.trim().toLowerCase(), u.id]));
  const out: Record<string, string> = {};
  for (const u of backup) {
    const id = byEmail.get(u.email.trim().toLowerCase());
    if (id && id !== u.id) out[u.id] = id;
  }
  return out;
}

// Fields that hold a person: who created the record, plus every "user" field (assigned to, technician, manager…).
const USER_FIELDS: Record<string, string[]> = Object.fromEntries(ENTITIES.map((e) => [e.key, e.fields.filter((f) => f.type === 'user').map((f) => f.key)]));
USER_FIELDS._settings = ['defaultSurveyor'];

/** Points the records at this device's accounts for the same people. */
export function remapStaff(data: DataMap, map: Record<string, string>): DataMap {
  if (!Object.keys(map).length) return data;
  const out: DataMap = {};
  for (const [key, list] of Object.entries(data)) {
    const fields = ['createdBy', ...(USER_FIELDS[key] || [])];
    out[key] = list.map((r) => {
      let copy = r;
      for (const f of fields) {
        const v = r[f];
        if (typeof v === 'string' && map[v]) { if (copy === r) copy = { ...r }; copy[f] = map[v]; }
      }
      return copy;
    });
  }
  return out;
}

/** Adds the backup's staff who are not on this device yet, with a random password nobody knows. */
export async function restoreStaff(backend: Backend, backup: BackupStaff[], here: AppUser[]): Promise<{ added: number; skipped: string[] }> {
  const ids = new Set(here.map((u) => u.id));
  const emails = new Set(here.map((u) => u.email.trim().toLowerCase()));
  let added = 0;
  const skipped: string[] = [];
  for (const u of backup) {
    if (ids.has(u.id) || emails.has(u.email.trim().toLowerCase())) continue;
    const pw = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
    try {
      await backend.saveUser({ ...u, active: u.active !== false }, pw);
      added++;
    } catch {
      skipped.push(u.name || u.email); // email or mobile already used on this device, or no mobile number saved
    }
  }
  return { added, skipped };
}
