// Accounts shown on the sign-in screen of this device ("Choose an account"), like a mail or social app.
// Only name and email are kept, and only when the person allowed it. Passwords are never stored.
const KEY = 'ss1:accounts';
const MAX = 6;

export interface KnownAccount { email: string; name: string; lastAt: string }

export function knownAccounts(): KnownAccount[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]') as KnownAccount[];
    return Array.isArray(list) ? list.filter((a) => a && typeof a.email === 'string' && a.email).slice(0, MAX) : [];
  } catch { return []; }
}

function save(list: KnownAccount[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* storage blocked: the list is a convenience only */ }
}

/** Puts the account first in the list (most recent sign-in first). */
export function rememberAccount(email: string, name: string): void {
  const e = email.trim().toLowerCase();
  if (!e) return;
  save([{ email: e, name: name.trim() || e, lastAt: new Date().toISOString() }, ...knownAccounts().filter((a) => a.email !== e)]);
}

export function forgetAccount(email: string): void {
  const e = email.trim().toLowerCase();
  save(knownAccounts().filter((a) => a.email !== e));
}
