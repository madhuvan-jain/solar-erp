import { describe, expect, it } from 'vitest';
import { crc32, excelDate, imagesToPdf, tableToCsv, tableToXlsx, zip, type ExportTable } from './exporters';

/** Reads a stored (uncompressed) zip back into name → text. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  while (dv.getUint32(o, true) === 0x04034b50) {
    const size = dv.getUint32(o + 18, true), nameLen = dv.getUint16(o + 26, true), extra = dv.getUint16(o + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(o + 30, o + 30 + nameLen));
    const start = o + 30 + nameLen + extra;
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(dv.getUint32(o + 14, true));
    out[name] = new TextDecoder().decode(data);
    o = start + size;
  }
  return out;
}

const T: ExportTable = {
  title: 'Leads: test/1',
  columns: [{ label: 'Name', type: 'text' }, { label: 'Account no.', type: 'text' }, { label: 'Amount', type: 'money' }, { label: 'Date', type: 'date' }, { label: 'Follow-up', type: 'datetime' }],
  rows: [['Ravi <& "Co">', '12345678901234567', 1234.5, '2026-11-10', '2026-11-10T10:30'], ['=HYPERLINK("x")', '', null, '', '']],
  totals: ['Total', null, 1234.5, null, null],
};

describe('exports', () => {
  it('CSV: readable date-times, harmless formulas, no totals row', () => {
    const csv = tableToCsv(T);
    expect(csv.split('\r\n')[0]).toBe('Name,Account no.,Amount,Date,Follow-up');
    expect(csv).toContain('2026-11-10 10:30');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.split('\r\n')).toHaveLength(3); // header + 2 rows: no totals row in CSV (it would import as a record)
  });

  it('Excel: a valid workbook with typed cells; long numbers kept as text', () => {
    const files = unzip(tableToXlsx(T));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']));
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('Ravi &lt;&amp; &quot;Co&quot;&gt;');
    expect(sheet).toContain('<t xml:space="preserve">12345678901234567</t>'); // text, not a rounded number
    expect(sheet).toMatch(/<c r="C2" s="4"><v>1234.5<\/v><\/c>/);
    expect(sheet).toMatch(new RegExp(`<c r="D2" s="2"><v>${excelDate('2026-11-10')}</v>`));
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:E3"/>');
    expect(files['xl/workbook.xml']).toContain('name="Leads  test 1"'); // characters Excel forbids in sheet names
    for (const x of Object.values(files)) expect(new DOMParser().parseFromString(x, 'application/xml').querySelector('parsererror')).toBeNull();
  });

  it('Excel dates: 1 Jan 1900 rules and times of day', () => {
    expect(excelDate('2026-01-01')).toBe(46023);
    expect(excelDate('2026-01-01T12:00')).toBe(46023.5);
    expect(excelDate('nope')).toBeNull();
  });

  it('PDF: pages, cross-reference table and images in order', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = imagesToPdf([{ jpeg, width: 10, height: 7 }, { jpeg, width: 10, height: 7 }], 842, 595, 'Leads');
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    // every object offset in the table points at "N 0 obj"
    const rows = text.slice(xref).split('\n').slice(3).filter((l) => / n $/.test(l));
    rows.forEach((l, i) => expect(text.slice(Number(l.slice(0, 10)), Number(l.slice(0, 10)) + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });

  it('zip of nothing is still a valid archive', () => {
    expect(zip([]).length).toBe(22);
  });
});

describe('list exports', () => {
  it('a list becomes typed columns: phones readable, money as numbers, a totals row, no empty Number column', async () => {
    const { LocalBackend } = await import('./store/local');
    const { Store } = await import('./store/store');
    const { entityTable } = await import('../modules/exportRows');
    const { getEntity } = await import('../modules/registry');
    localStorage.clear();
    const b = new LocalBackend();
    const { user } = await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    const s = new Store(b); s.user = user; await s.load();
    const c = await s.create('customers', { name: 'Ravi', phone: '+91-9876543211', city: 'Patna' });
    await s.create('quotations', { customerId: c.id, date: '2026-05-01', items: [{ description: 'Panel', qty: 2, rate: 100, gstRate: 5 }] });
    await s.create('quotations', { customerId: c.id, date: '2026-05-02', items: [{ description: 'Panel', qty: 1, rate: 100, gstRate: 5 }] });
    const cust = entityTable(s, getEntity('customers')!, s.all('customers'));
    await s.create('warehouses', { name: 'Patna store' });
    expect(entityTable(s, getEntity('warehouses')!, s.all('warehouses')).columns.some((x) => x.label === 'Number')).toBe(false); // no empty column
    const phoneCol = cust.columns.findIndex((x) => x.label === 'Phone');
    expect(cust.rows[0][phoneCol]).toBe('98765 43211');
    const q = entityTable(s, getEntity('quotations')!, s.all('quotations'));
    expect(q.columns[0]).toEqual({ label: 'Number', type: 'text' });
    const total = q.columns.findIndex((x) => x.label === 'Total');
    expect(q.columns[total].type).toBe('money');
    expect(typeof q.rows[0][total]).toBe('number');
    expect(q.totals?.[0]).toBe('Total');
    expect(q.totals?.[total]).toBe(315);
    expect(tableToCsv(q)).not.toContain("'+");
  });
});
