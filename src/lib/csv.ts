import { isNativeApp, saveInApp } from './nativeSave';
/** RFC 4180 CSV parser: quoted fields, escaped quotes, embedded newlines, CRLF and a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === '') { quoted = true; cell = ''; } // opens a field at its start, also after spaces (`a, "b, c"`)
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

/** Undoes the export-side formula guard so "'+91 98765…" re-imports as "+91 98765…". */
export function unguard(v: string): string {
  return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;
}

/** Set on a row that has more cells than the file has headers. */
export const EXTRA = '__extra_cells';

/** Parses into objects keyed by header. Header matching ignores case and spaces. */
export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) o[h] = unguard((r[i] ?? '').trim()); });
    // More filled cells than headers: a comma or quote in the wrong place has shifted the columns.
    if (r.slice(headers.length).some((v) => v.trim() !== '')) o[EXTRA] = String(r.length - headers.length);
    return o;
  });
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formula injection when the file is opened in Excel (plain numbers are left alone).
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  // The byte-order mark makes Excel read ₹ and Hindi text correctly; it must never go into JSON.
  const blob = new Blob([mime.startsWith('text/csv') ? '\uFEFF' + content : content], { type: mime });
  if (isNativeApp()) { void saveInApp(filename, blob); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File.text() is missing on older Safari; FileReader works everywhere. */
export function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? '').replace(/^\uFEFF/, '')); // tolerate files saved with a BOM
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
