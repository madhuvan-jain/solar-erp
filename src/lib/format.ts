import { BRAND } from '../config/brand';

export function todayIso(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(v: unknown): string {
  if (!v) return '—';
  const s = String(v);
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  if (Number.isNaN(d.getTime())) return '—';
  return s.length === 10
    ? d.toLocaleDateString(BRAND.locale, { day: '2-digit', month: 'short', year: 'numeric' })
    : d.toLocaleString(BRAND.locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** RFC 4122 v4 UUID. randomUUID needs HTTPS; getRandomValues works everywhere. */
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Calendar date (YYYY-MM-DD) of a timestamp in the device's time zone (IST in India), not UTC. */
export function localDateOf(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return String(isoTimestamp).slice(0, 10);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Date and time (YYYY-MM-DDTHH:mm, as a date-time field stores it) of a timestamp in the device's time zone, not UTC. */
export function localDateTimeOf(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return String(isoTimestamp).slice(0, 16);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}


