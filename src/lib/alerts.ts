import { pushPref } from './prefs';
import { tracksStock } from './store/stock';
import type { Store } from './store/store';
import { addDaysIso, todayIso } from './format';

export interface Alert {
  id: string;
  level: 'danger' | 'warning' | 'info';
  text: string;
  entity: string;
  recordId: string;
}

const day = (v: unknown) => String(v || '').slice(0, 10);

/** Next EMI date on or after `today`, given the first EMI date. Handles month-end (31st → 28/30). */
export function nextEmiDate(first: string, today: string, tenureMonths: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) return null;
  const [y, m, d] = first.split('-').map(Number);
  for (let i = 0; i < Math.max(1, tenureMonths || 1); i++) {
    const mm = m - 1 + i;
    const yy = y + Math.floor(mm / 12);
    const mo = mm % 12;
    const last = new Date(Date.UTC(yy, mo + 1, 0)).getUTCDate();
    const iso = new Date(Date.UTC(yy, mo, Math.min(d, last))).toISOString().slice(0, 10);
    if (iso >= today) return iso;
  }
  return null;
}

export function computeAlerts(store: Store, today = todayIso(), userId?: string): Alert[] {
  const out: Alert[] = [];
  const in7 = addDaysIso(today, 7);
  const in30 = addDaysIso(today, 30);
  const mine = (owner: unknown) => !userId || !owner || owner === userId;

  for (const l of store.all('leads')) {
    if (l.status === 'New' && !l.assignedTo) {
      out.push({ id: 'na' + l.id, level: 'warning', text: `Unassigned new lead: ${l.name}`, entity: 'leads', recordId: l.id });
    }
    if (['Won', 'Lost'].includes(String(l.status)) || !l.nextFollowUp || !mine(l.assignedTo)) continue;
    const d = day(l.nextFollowUp);
    if (d < today) out.push({ id: 'fu' + l.id, level: 'danger', text: `Follow-up overdue: ${l.name}`, entity: 'leads', recordId: l.id });
    else if (d === today) out.push({ id: 'fu' + l.id, level: 'warning', text: `Follow-up today: ${l.name}`, entity: 'leads', recordId: l.id });
  }
  for (const t of store.all('tasks')) {
    if (t.status === 'Done' || !t.dueDate || !mine(t.assignee)) continue;
    if (day(t.dueDate) < today) out.push({ id: 'tk' + t.id, level: 'danger', text: `Task overdue: ${t.title}`, entity: 'tasks', recordId: t.id });
  }
  for (const p of store.all('projects')) {
    if (['Handover', 'On Hold'].includes(String(p.stage)) || !p.dueDate) continue;
    if (day(p.dueDate) < today) out.push({ id: 'pj' + p.id, level: 'danger', text: `Project delayed: ${p.name}`, entity: 'projects', recordId: p.id });
  }
  for (const i of store.all('installations')) {
    if (['Completed', 'Cancelled'].includes(String(i.status))) continue;
    const d = day(i.scheduledDate);
    if (i.status === 'Delayed' || (d && d < today))
      out.push({ id: 'in' + i.id, level: 'danger', text: `Installation delayed: ${i.number}`, entity: 'installations', recordId: i.id });
    else if (d === today)
      out.push({ id: 'in' + i.id, level: 'info', text: `Installation today: ${i.number}`, entity: 'installations', recordId: i.id });
  }
  for (const p of store.all('products')) {
    const lvl = Number(p.reorderLevel) || 0;
    if (lvl <= 0 || !tracksStock(p)) continue;
    const s = store.stockOf(p.id);
    const coming = store.onOrder(p.id);
    if (s <= lvl) out.push({ id: 'st' + p.id, level: s <= 0 ? 'danger' : 'warning', text: `Low stock: ${p.name} (${s} left${coming > 0 ? `, ${coming} on order` : ''})`, entity: 'products', recordId: p.id });
  }
  for (const inv of store.all('invoices')) {
    if (['Cancelled', 'Draft'].includes(String(inv.status)) || !inv.dueDate) continue;
    if (day(inv.dueDate) < today && store.computed('invoices', inv).balance > 0)
      out.push({ id: 'iv' + inv.id, level: 'danger', text: `Payment overdue: ${inv.number}`, entity: 'invoices', recordId: inv.id });
  }
  for (const a of store.all('amcs')) {
    if (a.status !== 'Active' || !a.endDate) continue;
    const d = day(a.endDate);
    if (d < today) out.push({ id: 'am' + a.id, level: 'danger', text: `AMC expired: ${a.number}`, entity: 'amcs', recordId: a.id });
    else if (d <= in30) out.push({ id: 'am' + a.id, level: 'warning', text: `AMC renewal due ${d}: ${a.number}`, entity: 'amcs', recordId: a.id });
  }
  for (const ln of store.all('loans')) {
    if (!['Disbursed', 'Repaying'].includes(String(ln.status)) || !ln.firstEmiDate) continue;
    const next = nextEmiDate(String(ln.firstEmiDate), today, Number(ln.tenureMonths));
    if (next && next <= in7) out.push({ id: 'ln' + ln.id, level: 'info', text: `EMI due ${next}: ${ln.number}`, entity: 'loans', recordId: ln.id });
  }
  for (const t of store.all('tickets')) {
    if (['Resolved', 'Closed'].includes(String(t.status)) || !mine(t.assignedTo)) continue;
    if (t.dueDate && day(t.dueDate) < today)
      out.push({ id: 'tt' + t.id, level: 'danger', text: `Ticket overdue: ${t.subject}`, entity: 'tickets', recordId: t.id });
    else if (t.priority === 'Urgent')
      out.push({ id: 'tt' + t.id, level: 'warning', text: `Urgent ticket: ${t.subject}`, entity: 'tickets', recordId: t.id });
  }
  for (const s of store.all('subsidies')) {
    if (['Disbursed', 'Rejected'].includes(String(s.status)) || !s.appliedOn) continue;
    if (day(s.appliedOn) < addDaysIso(today, -45))
      out.push({ id: 'sb' + s.id, level: 'warning', text: `Subsidy pending 45+ days: ${s.number}`, entity: 'subsidies', recordId: s.id });
  }
  for (const d of store.all('documents')) {
    if (!d.expiresOn) continue;
    const v = day(d.expiresOn);
    if (v < addDaysIso(today, -30)) continue; // long expired: no longer news
    if (v < today) out.push({ id: 'dx' + d.id, level: 'warning', text: `Document expired ${v}: ${d.name}`, entity: 'documents', recordId: d.id });
    else if (v <= in30) out.push({ id: 'dx' + d.id, level: 'info', text: `Document valid only till ${v}: ${d.name}`, entity: 'documents', recordId: d.id });
  }
  const order = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Kinds of alert a person can switch on or off (Settings → Alerts). The key is the start of each alert's id. */
export const ALERT_TYPES: { key: string; label: string; module: string }[] = [
  { key: 'fu', label: 'Lead follow-ups (overdue and today)', module: 'crm' },
  { key: 'na', label: 'New leads nobody is assigned to', module: 'crm' },
  { key: 'tk', label: 'Overdue tasks', module: 'projects' },
  { key: 'pj', label: 'Delayed projects', module: 'projects' },
  { key: 'in', label: 'Installations (delayed and today)', module: 'installation' },
  { key: 'st', label: 'Low or no stock', module: 'inventory' },
  { key: 'iv', label: 'Overdue invoice payments', module: 'finance' },
  { key: 'am', label: 'AMC renewals and expiries', module: 'service' },
  { key: 'tt', label: 'Service tickets (overdue and urgent)', module: 'service' },
  { key: 'ln', label: 'Loan EMIs due within a week', module: 'loans' },
  { key: 'sb', label: 'Subsidy applications pending 45+ days', module: 'subsidy' },
  { key: 'dx', label: 'Documents expiring (warranties, agreements)', module: 'documents' },
];

export const alertType = (a: Alert) => a.id.slice(0, 2);

export interface AlertPrefs { custom: boolean; on: string[] }
const prefKey = (userId: string) => `ss1:alertprefs:${userId}`;

/** Off by default: everyone gets every alert their access allows. Turned on, only the ticked kinds show. */
export function alertPrefs(userId: string): AlertPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(prefKey(userId)) || 'null') as AlertPrefs | null;
    if (v && typeof v.custom === 'boolean' && Array.isArray(v.on)) return v;
  } catch { /* fall through */ }
  return { custom: false, on: ALERT_TYPES.map((t) => t.key) };
}

export function saveAlertPrefs(userId: string, p: AlertPrefs): void {
  try { localStorage.setItem(prefKey(userId), JSON.stringify(p)); } catch { /* blocked storage: defaults stay */ }
  pushPref('alertprefs', p);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ss1-alertprefs'));
}

/** The alerts this person should see: their access rights, then their own choice of kinds. */
export function myAlerts(store: Store, canSee: (module: string) => boolean, entityModule: (entity: string) => string, today = todayIso()): Alert[] {
  const prefs = store.user ? alertPrefs(store.user.id) : null;
  return computeAlerts(store, today).filter((a) => canSee(entityModule(a.entity)) && (!prefs?.custom || prefs.on.includes(alertType(a))));
}

