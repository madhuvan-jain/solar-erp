// Exporting a table (a list or a report) as Excel, PDF or CSV — written here, no outside libraries.
//  • Excel (.xlsx): real numbers, money and dates (sortable, summable), long numbers such as account or
//    consumer numbers kept exactly as text, a bold frozen header row with filters.
//  • PDF: A4 landscape pages drawn in the browser, so ₹ and Hindi names print correctly; page numbers.
//  • CSV: plain text for other software; formulas made harmless, dates readable.
import { toCsv } from './csv';
import { isNativeApp, saveInApp } from './nativeSave';

export type ColType = 'text' | 'number' | 'money' | 'date' | 'datetime';
export interface Column { label: string; type: ColType }
export type Cell = string | number | null | undefined;
export interface ExportTable {
  /** e.g. "Leads" — file and sheet name */
  title: string;
  /** e.g. "60 records · Status: New · 11 Nov 2026" — printed under the title on PDFs */
  subtitle?: string;
  /** company name, printed at the top of PDFs */
  company?: string;
  columns: Column[];
  rows: Cell[][];
  /** optional last row in bold (totals) */
  totals?: Cell[];
}

const isNum = (v: Cell): v is number => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------- CSV

export function tableToCsv(t: ExportTable): string {
  const fmt = (c: Column, v: Cell) => {
    if (v === null || v === undefined) return '';
    if (c.type === 'datetime' && typeof v === 'string') return v.replace('T', ' ').slice(0, 16);
    return v;
  };
  // No totals row in CSV: a CSV is for other software and for importing back, where a "Total" row would be a record.
  const rows = t.rows.map((r) => t.columns.map((c, i) => fmt(c, r[i])));
  return toCsv(t.columns.map((c) => c.label), rows);
}

// ---------------------------------------------------------------- ZIP (stored, no compression)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true); local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true); cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, f.data.length, true); cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return concat([...parts, ...central, new Uint8Array(end.buffer)]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------------------------------------------------------------- Excel (.xlsx)

const xml = (s: string) => s
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colName = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** Excel date number for "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (local time, as typed). */
export function excelDate(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v);
  if (!m) return null;
  const days = (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000;
  return days + (m[4] ? (+m[4] * 60 + +m[5]) / 1440 : 0);
}

// style ids in styles.xml below
const ST = { text: 0, header: 1, date: 2, datetime: 3, money: 4, number: 5, bold: 6, boldMoney: 7, boldNumber: 8 } as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="dd-mmm-yyyy"/><numFmt numFmtId="165" formatCode="dd-mmm-yyyy hh:mm"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1EE"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref: string, c: Column, v: Cell, bold = false): string {
  if (v === null || v === undefined || v === '') return '';
  if ((c.type === 'money' || c.type === 'number') && isNum(v)) {
    const s = c.type === 'money' ? (bold ? ST.boldMoney : ST.money) : (bold ? ST.boldNumber : ST.number);
    return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  }
  if ((c.type === 'date' || c.type === 'datetime') && typeof v === 'string') {
    const n = excelDate(v);
    if (n !== null) return `<c r="${ref}" s="${c.type === 'date' || !/[T ]\d/.test(v) ? ST.date : ST.datetime}"><v>${n}</v></c>`;
  }
  // Everything else is text, exactly as shown — so 16-digit account numbers and PIN codes stay whole.
  return `<c r="${ref}" t="inlineStr" s="${bold ? ST.bold : ST.text}"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
}

const sheetName = (s: string) => (s.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet1').slice(0, 31);

export function tableToXlsx(t: ExportTable): Uint8Array {
  const enc = new TextEncoder();
  const n = t.columns.length;
  const rows: string[] = [];
  rows.push(`<row r="1">${t.columns.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="${ST.header}"><is><t xml:space="preserve">${xml(c.label)}</t></is></c>`).join('')}</row>`);
  t.rows.forEach((r, ri) => rows.push(`<row r="${ri + 2}">${t.columns.map((c, i) => cellXml(`${colName(i)}${ri + 2}`, c, r[i])).join('')}</row>`));
  if (t.totals) {
    const at = t.rows.length + 2;
    rows.push(`<row r="${at}">${t.columns.map((c, i) => cellXml(`${colName(i)}${at}`, c, t.totals![i], true)).join('')}</row>`);
  }
  const width = (i: number) => {
    const c = t.columns[i];
    if (c.type === 'date') return 13;
    if (c.type === 'datetime') return 18;
    const longest = Math.max(c.label.length, ...t.rows.slice(0, 300).map((r) => (r[i] === null || r[i] === undefined ? 0 : String(r[i]).length)));
    return Math.min(50, Math.max(8, longest + 2));
  };
  const last = `${colName(Math.max(0, n - 1))}${t.rows.length + 1}`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${n ? `<cols>${t.columns.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(i)}" customWidth="1"/>`).join('')}</cols>` : ''}
<sheetData>${rows.join('')}</sheetData>
${n && t.rows.length ? `<autoFilter ref="A1:${last}"/>` : ''}
</worksheet>`;
  const name = xml(sheetName(t.title));
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>${n && t.rows.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$1:$${colName(n - 1)}$${t.rows.length + 1}</definedName></definedNames>` : ''}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ];
  return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.data) })));
}

// ---------------------------------------------------------------- PDF (pages drawn on a canvas)

/** A PDF made of full-page JPEG images (one per page), A4 landscape unless sizes are given. */
export function imagesToPdf(pages: { jpeg: Uint8Array; width: number; height: number }[], pageW = 842, pageH = 595, title = ''): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); pos += u.length; };
  const obj = (n: number, body: () => void) => { offsets[n] = pos; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'.replace(/[\u0080-ÿ]/g, 'x'));
  const count = pages.length;
  const pageObj = (i: number) => 4 + i * 3;
  obj(1, () => push(`<< /Type /Catalog /Pages 2 0 R >>`));
  obj(2, () => push(`<< /Type /Pages /Count ${count} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`));
  const safeTitle = title.replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '');
  obj(3, () => push(`<< /Title (${safeTitle}) /Producer (SuryaSetu) >>`));
  pages.forEach((p, i) => {
    const n = pageObj(i);
    const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im${i} Do Q`;
    obj(n, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im${i} ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`));
    obj(n + 1, () => { push(`<< /Length ${content.length} >>\nstream\n`); push(content); push('\nendstream'); });
    obj(n + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg); push('\nendstream');
    });
  });
  const total = 4 + count * 3;
  const xrefAt = pos;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n] || 0).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return concat(chunks);
}

const PX = 2; // canvas pixels per PDF point: sharp on screens and when printed
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", sans-serif';

function shown(c: Column, v: Cell): string {
  if (v === null || v === undefined) return '';
  if (c.type === 'money' && isNum(v)) return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (c.type === 'number' && isNum(v)) return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if ((c.type === 'date' || c.type === 'datetime') && typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(v);
    if (m) {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
      return m[4] && c.type === 'datetime' ? `${d} ${m[4]}` : d;
    }
  }
  return String(v).replace(/\s+/g, ' ');
}

/** Draws the table on A4 landscape pages and returns a PDF file. Needs a browser (canvas). */
export async function tableToPdf(t: ExportTable): Promise<Uint8Array> {
  const W = 842, H = 595, M = 28;
  const canvas = document.createElement('canvas');
  canvas.width = W * PX; canvas.height = H * PX;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This browser cannot make PDF files. Use Print → Save as PDF instead.');
  g.scale(PX, PX);
  const all = t.totals ? [...t.rows, t.totals] : t.rows;
  const text = all.map((r) => t.columns.map((c, i) => shown(c, r[i])));
  const right = t.columns.map((c) => c.type === 'money' || c.type === 'number');

  // Column widths from the text (header and up to 400 rows), then fitted to the page; the font shrinks for many columns.
  let size = 8.5;
  let widths: number[] = [];
  const avail = W - 2 * M;
  for (; size >= 5.5; size -= 0.5) {
    g.font = `${size}px ${FONT}`;
    const natural = t.columns.map((c, i) => {
      g.font = `600 ${size}px ${FONT}`;
      const head = g.measureText(c.label).width;
      g.font = `${size}px ${FONT}`;
      let widest = 0;
      for (let r = 0; r < Math.min(text.length, 400); r++) widest = Math.max(widest, g.measureText(text[r][i]).width);
      return Math.min(Math.max(head, widest) + 10, avail * 0.4);
    });
    const sum = natural.reduce((s, w) => s + w, 0);
    widths = natural.map((w) => (w * avail) / Math.max(sum, avail * 0.6));
    if (sum <= avail * 1.15) break; // fits, or nearly (text is cut with … rather than shrunk further)
  }
  const rowH = size * 1.9;
  const headH = 56;
  const perPage = Math.max(1, Math.floor((H - M - headH - M - 14) / rowH) - 1);
  const pageCount = Math.max(1, Math.ceil(text.length / perPage));
  const fit = (s: string, w: number) => {
    if (g.measureText(s).width <= w) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.measureText(s.slice(0, mid) + '…').width <= w) lo = mid; else hi = mid - 1; }
    return s.slice(0, lo) + '…';
  };
  const printed = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const pages: { jpeg: Uint8Array; width: number; height: number }[] = [];

  for (let p = 0; p < pageCount; p++) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111827'; g.textBaseline = 'alphabetic';
    let y = M + 12;
    if (t.company) { g.font = `700 13px ${FONT}`; g.fillText(fit(t.company, avail), M, y); y += 17; }
    g.font = `600 11.5px ${FONT}`; g.fillText(fit(t.title, avail), M, y); y += 14;
    g.fillStyle = '#6b7280'; g.font = `8px ${FONT}`;
    g.fillText(fit(t.subtitle || `${t.rows.length} record(s)`, avail), M, y);
    y = M + headH;
    // header row
    g.fillStyle = '#e8f1ee'; g.fillRect(M, y - rowH + 3, avail, rowH);
    g.fillStyle = '#0f3d33'; g.font = `600 ${size}px ${FONT}`;
    let x = M;
    t.columns.forEach((c, i) => {
      const s = fit(c.label, widths[i] - 8);
      g.textAlign = right[i] ? 'right' : 'left';
      g.fillText(s, right[i] ? x + widths[i] - 4 : x + 4, y);
      x += widths[i];
    });
    g.textAlign = 'left';
    const slice = text.slice(p * perPage, (p + 1) * perPage);
    slice.forEach((r, ri) => {
      y += rowH;
      const isTotal = !!t.totals && p * perPage + ri === text.length - 1;
      if (ri % 2 === 1) { g.fillStyle = '#f7f8fa'; g.fillRect(M, y - rowH + 3, avail, rowH); }
      if (isTotal) { g.strokeStyle = '#9ca3af'; g.beginPath(); g.moveTo(M, y - rowH + 3); g.lineTo(M + avail, y - rowH + 3); g.stroke(); }
      g.fillStyle = '#111827'; g.font = `${isTotal ? '600 ' : ''}${size}px ${FONT}`;
      let cx = M;
      r.forEach((s, i) => {
        g.textAlign = right[i] ? 'right' : 'left';
        g.fillText(fit(s, widths[i] - 8), right[i] ? cx + widths[i] - 4 : cx + 4, y);
        cx += widths[i];
      });
      g.textAlign = 'left';
    });
    g.fillStyle = '#9ca3af'; g.font = `7.5px ${FONT}`;
    g.fillText(`Printed ${printed}`, M, H - M + 10);
    g.textAlign = 'right'; g.fillText(`Page ${p + 1} of ${pageCount}`, W - M, H - M + 10); g.textAlign = 'left';
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) throw new Error('Could not draw the PDF page.');
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  }
  return imagesToPdf(pages, W, H, t.title);
}

// ---------------------------------------------------------------- saving

export function downloadBytes(filename: string, data: Uint8Array | string | Blob, mime: string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  if (isNativeApp()) { void saveInApp(filename, blob); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export type ExportKind = 'xlsx' | 'pdf' | 'csv';
const safeFile = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'export';

export async function exportTable(t: ExportTable, kind: ExportKind, baseName: string): Promise<void> {
  const name = safeFile(baseName);
  if (kind === 'xlsx') return downloadBytes(`${name}.xlsx`, tableToXlsx(t), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (kind === 'pdf') return downloadBytes(`${name}.pdf`, await tableToPdf(t), 'application/pdf');
  // The byte-order mark makes Excel read ₹ and Hindi text in a CSV correctly.
  return downloadBytes(`${name}.csv`, '﻿' + tableToCsv(t), 'text/csv;charset=utf-8');
}
