import type { Entity, Field, LineItem } from './schema';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Strips spaces, dashes and a leading +91 / 0 so the same number always compares equal. */
export function normalizePhone(v: string): string {
  let d = v.replace(/[^\d+]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (d.startsWith('+')) return d;
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

export function isValidPhone(v: string): boolean {
  const n = normalizePhone(v);
  if (n.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(n);
  // 10-digit mobile (6–9…) or landline with STD code (e.g. 0612… stored as 612…); never all zeros.
  return /^[1-9]\d{9}$/.test(n) && !/^(\d)\1{9}$/.test(n);
}

/** An Indian mobile number as +91XXXXXXXXXX (10 digits starting 6–9), or null if it is not one. */
export function toMobile(v: unknown): string | null {
  const n = normalizePhone(String(v ?? ''));
  return /^[6-9]\d{9}$/.test(n) && !/^(\d)\1{9}$/.test(n) ? '+91' + n : null;
}

/** +919876543210 → "+91 98765 43210" */
export function formatMobile(m?: string | null): string {
  return m && /^\+91\d{10}$/.test(m) ? `+91 ${m.slice(3, 8)} ${m.slice(8)}` : m || '';
}

export const isValidEmail = (v: string) => EMAIL_RE.test(v.trim());
export const isValidGstin = (v: string) => GSTIN_RE.test(v.trim().toUpperCase());
export const isValidPan = (v: string) => PAN_RE.test(v.trim().toUpperCase());

export function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Real calendar dates only (rejects 2026-02-31), years 1900–2200. */
export function isValidDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12) return false;
  if (d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return false;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59)) return false;
  return true;
}

const MAX_NUMBER = 1e12;

export function validateField(f: Field, v: unknown): string | null {
  if (isEmpty(v)) return f.required ? `${f.label} is required` : null;
  switch (f.type) {
    case 'email':
      return isValidEmail(String(v)) ? null : 'Enter a valid email address';
    case 'phone':
      return isValidPhone(String(v)) ? null : 'Enter a valid phone number';
    case 'gstin':
      return isValidGstin(String(v)) ? null : 'GSTIN must be 15 characters, e.g. 22AAAAA0000A1Z5';
    case 'pan':
      return isValidPan(String(v)) ? null : 'PAN must look like ABCDE1234F';
    case 'pincode':
      return /^[1-9]\d{5}$/.test(String(v).replace(/\s/g, '')) ? null : 'PIN code must be 6 digits';
    case 'number':
    case 'money':
    case 'percent': {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return `${f.label} must be a number`;
      if (Math.abs(n) > MAX_NUMBER) return `${f.label} is too large`;
      if (f.integer && !Number.isInteger(n)) return `${f.label} must be a whole number`;
      if (f.min !== undefined && n < f.min) return `${f.label} must be at least ${f.min}`;
      if (f.max !== undefined && n > f.max) return `${f.label} must be at most ${f.max}`;
      return null;
    }
    case 'date':
    case 'datetime':
      return isValidDate(String(v)) ? null : 'Enter a valid date';
    case 'time':
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? null : 'Enter a time like 09:30';
    case 'select':
      return f.options && !f.options.includes(String(v)) ? `Choose a valid ${f.label}` : null;
    case 'items': {
      const items = v as LineItem[];
      if (!Array.isArray(items)) return 'Invalid items';
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it || typeof it !== 'object') return `Line ${i + 1} is invalid`;
        if (!it.description || !String(it.description).trim()) return `Line ${i + 1}: description is required`;
        if (!Number.isFinite(it.qty) || it.qty <= 0) return `Line ${i + 1}: quantity must be more than 0`;
        if (!Number.isFinite(it.rate) || it.rate < 0) return `Line ${i + 1}: rate cannot be negative`;
        if (it.qty > MAX_NUMBER || it.rate > MAX_NUMBER) return `Line ${i + 1}: value is too large`;
        if (!Number.isFinite(it.gstRate) || it.gstRate < 0 || it.gstRate > 100) return `Line ${i + 1}: invalid GST %`;
        if (it.discountPct !== undefined && it.discountPct !== null && (!Number.isFinite(it.discountPct) || it.discountPct < 0 || it.discountPct > 100)) {
          return `Line ${i + 1}: discount must be between 0 and 100%`;
        }
      }
      return null;
    }
    default:
      if (String(v).length > (f.maxLength ?? (f.type === 'textarea' ? 5000 : 300))) return `${f.label} is too long`;
      if (f.maxLength && String(v).length > f.maxLength) return `${f.label} is too long (max ${f.maxLength})`;
      return null;
  }
}

export function validateRecord(entity: Entity, data: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of entity.fields) {
    const e = validateField(f, data[f.key]);
    if (e) errors[f.key] = e;
  }
  if (entity.key === 'amcs' && data.startDate && data.endDate && String(data.endDate) < String(data.startDate)) {
    errors.endDate = 'End date cannot be before start date';
  }
  if (entity.key === 'projects' && data.startDate && data.dueDate && String(data.dueDate) < String(data.startDate)) {
    errors.dueDate = 'Target date cannot be before start date';
  }
  return errors;
}

/** Converts raw form strings into typed values (numbers, booleans, upper-cased IDs). */
export function coerce(entity: Entity, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const f of entity.fields) {
    const v = data[f.key];
    if (v === undefined) continue;
    if (['number', 'money', 'percent'].includes(f.type)) {
      if (v === null || (typeof v === 'string' && v.trim() === '')) out[f.key] = null;
      else out[f.key] = typeof v === 'number' ? v : Number(String(v).replace(/[,\s₹]/g, ''));
    } else if (f.type === 'bool') {
      out[f.key] = v === true || (typeof v === 'string' && ['true', 'yes', 'y', '1'].includes(v.trim().toLowerCase()));
    } else if (f.type === 'select' && typeof v === 'string' && f.options) {
      // "bihar ", "BIHAR" and "Bihar" are the same choice.
      const t = v.trim();
      out[f.key] = f.options.find((o) => o.toLowerCase() === t.toLowerCase()) ?? t;
    } else if (f.type === 'pincode') {
      out[f.key] = typeof v === 'string' ? v.replace(/\s/g, '') : v;
    } else if (f.type === 'gstin' || f.type === 'pan') {
      out[f.key] = typeof v === 'string' ? v.trim().toUpperCase() : v;
    } else if (typeof v === 'string' && f.type !== 'file' && f.type !== 'textarea') {
      out[f.key] = v.trim();
    }
  }
  return out;
}
