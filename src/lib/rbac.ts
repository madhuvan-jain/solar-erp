import type { AppUser, Role } from './store/types';

// Keep in sync with public.my_level() in supabase/schema.sql (the database enforces the same rules).

/**
 * Access level in one app, lowest to highest:
 * none — app hidden · read — sees everything, changes nothing · own — sees and changes only records they
 * created or are assigned to · all — sees and changes every record · manager — all, and may delete.
 */
export type Level = 'none' | 'read' | 'own' | 'all' | 'manager';
export type AccessMap = Partial<Record<string, Level>>;

export const LEVELS: Level[] = ['none', 'read', 'own', 'all', 'manager'];

export const LEVEL_LABELS: Record<Level, string> = {
  none: 'No access',
  read: 'Viewer — read only',
  own: 'User — own documents only',
  all: 'User — all documents',
  manager: 'Manager — all documents, can delete',
};

/** Apps where "own documents only" makes sense. Stock, purchase, accounts and staff are shared books, so not here. */
export const OWN_APPS = new Set(['crm', 'sales', 'projects', 'installation', 'service', 'subsidy', 'loans', 'documents']);

const ALL = ['crm', 'sales', 'projects', 'installation', 'inventory', 'purchase', 'finance', 'subsidy', 'loans', 'service', 'documents', 'staff'];

/** What each role starts with. The admin can then change any app for one person (Settings → Users & access → Access rights). */
const PRESETS: Record<Role, Record<string, Level>> = {
  admin: Object.fromEntries(ALL.map((m) => [m, 'manager'])),
  manager: Object.fromEntries(ALL.map((m) => [m, 'manager'])),
  sales: { crm: 'all', sales: 'all', projects: 'read', documents: 'all', subsidy: 'all', loans: 'all', inventory: 'read' },
  technician: { projects: 'all', installation: 'all', service: 'all', inventory: 'read', documents: 'all', crm: 'read', sales: 'all' },
  accounts: { finance: 'all', purchase: 'all', inventory: 'all', subsidy: 'all', loans: 'all', crm: 'read', projects: 'read', documents: 'all', staff: 'all', sales: 'all' },
  pending: {},
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin (everything + users & settings)',
  manager: 'Manager (all modules, can delete)',
  sales: 'Sales',
  technician: 'Technician / Installer',
  accounts: 'Accounts',
  pending: 'Pending approval (no access)',
};

/** A role on its own, or a user (role plus any per-app changes the admin made). */
export type Who = Role | Pick<AppUser, 'role' | 'access'> | null | undefined;

export function presetLevel(role: Role, module: string): Level {
  return PRESETS[role]?.[module] || 'none';
}

export function isValidLevel(module: string, v: unknown): v is Level {
  return typeof v === 'string' && (LEVELS as string[]).includes(v) && (v !== 'own' || OWN_APPS.has(module));
}

export function levelOf(who: Who, module: string): Level {
  if (!who) return 'none';
  const role = typeof who === 'string' ? who : who.role;
  if (role === 'pending' || !PRESETS[role]) return 'none';
  if (role === 'admin') return 'manager'; // the admin always has everything
  const custom = typeof who === 'string' ? undefined : who.access?.[module];
  return isValidLevel(module, custom) ? custom : presetLevel(role, module);
}

export function canRead(who: Who, module: string): boolean {
  return levelOf(who, module) !== 'none';
}

export function canWrite(who: Who, module: string): boolean {
  const l = levelOf(who, module);
  return l === 'own' || l === 'all' || l === 'manager';
}

export function canDelete(who: Who, module: string): boolean {
  return levelOf(who, module) === 'manager';
}

export function isAdmin(who: Who): boolean {
  return (typeof who === 'string' ? who : who?.role) === 'admin';
}

/** A record is "yours" if you created it or any of its people fields (assigned to, manager, surveyor…) is you. */
export function isOwnRecord(rec: Record<string, unknown>, userId: string): boolean {
  if (rec.createdBy === userId) return true;
  for (const [k, v] of Object.entries(rec)) if (k !== 'id' && v === userId) return true;
  return false;
}

/** Only the per-app changes that differ from the role's preset, so a later preset change still applies to the rest. */
export function accessOverrides(role: Role, levels: Record<string, Level>): AccessMap {
  const out: AccessMap = {};
  for (const [m, l] of Object.entries(levels)) if (isValidLevel(m, l) && l !== presetLevel(role, m)) out[m] = l;
  return out;
}
