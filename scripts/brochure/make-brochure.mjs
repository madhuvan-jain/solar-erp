// Builds the product brochure from REAL screenshots of the app filled with demo data.
//
//   node scripts/brochure/make-brochure.mjs
//
// 1. starts `vite preview` on the already-built dist/ (run `npm run build` first if the app changed),
// 2. creates the admin through the UI, injects a demo dataset into localStorage, reloads,
// 3. takes desktop + phone screenshots into docs/brochure/img/,
// 4. renders docs/brochure/brochure.html to docs/<BRAND.name>-Brochure.pdf.
//
// Everything here is demo data for a fictional company. Nothing is sent anywhere.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMG = join(ROOT, 'docs', 'brochure', 'img');
const HTML = join(ROOT, 'docs', 'brochure', 'brochure.html');
const PORT = 4181;
const BASE = `http://localhost:${PORT}/`;
const ONLY = process.env.ONLY || ''; // e.g. ONLY=pdf skips the screenshots (re-renders the PDF only)

const brandSrc = readFileSync(join(ROOT, 'src', 'config', 'brand.ts'), 'utf8');
const BRAND = {
  name: /name:\s*'([^']+)'/.exec(brandSrc)?.[1] || 'SuryaSetu',
  tagline: /tagline:\s*'([^']+)'/.exec(brandSrc)?.[1] || '',
};
const PDF = join(ROOT, 'docs', `${BRAND.name}-Brochure.pdf`);

// ---------------------------------------------------------------- helpers (same maths as src/lib/money.ts)
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const lineAmount = (it) => (Number(it.qty) || 0) * (Number(it.rate) || 0) * (1 - Math.min(Math.max(Number(it.discountPct) || 0, 0), 100) / 100);
function computeTotals(items, discount = 0, interState = false) {
  const lines = items || [];
  const rawSubtotal = lines.reduce((s, it) => s + lineAmount(it), 0);
  const subtotal = round2(rawSubtotal);
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  let rawTax = 0;
  for (const it of lines) {
    const v = lineAmount(it);
    const share = rawSubtotal > 0 ? v / rawSubtotal : 0;
    rawTax += (v - disc * share) * ((Number(it.gstRate) || 0) / 100);
  }
  const taxable = round2(subtotal - disc);
  let tax;
  if (interState) tax = round2(rawTax);
  else { const half = round2(rawTax / 2); tax = round2(half + half); }
  const exact = round2(taxable + tax);
  return { subtotal, taxable, tax, grandTotal: Math.round(exact) };
}
function financialYear(iso) {
  const y = Number(iso.slice(0, 4)) - (Number(iso.slice(5, 7)) < 4 ? 1 : 0);
  return `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`;
}
function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const TODAY = localToday();
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const D = (n) => addDays(TODAY, n);
const weekday = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
/** Moves Sundays to Monday so business documents fall on working days. */
const work = (iso) => (weekday(iso) === 0 ? addDays(iso, 1) : iso);
const stamp = (iso, h = 11, m = 0) => new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`).toISOString();

// Deterministic randomness so every run produces the same brochure.
let seed = 20261104;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
let phoneN = 0;
const phone = () => { const p = ['98350', '94310', '70040', '88770', '99055', '63520', '91220', '80920']; phoneN++; return `${p[phoneN % p.length]} ${String(10000 + ((phoneN * 7919) % 89999)).padStart(5, '0')}`; };

// ---------------------------------------------------------------- the demo dataset
function buildData(admin) {
  const data = {};
  let creator = admin.id;
  const add = (entity, fields, createdIso, by) => {
    const createdAt = createdIso || stamp(TODAY);
    const r = { id: randomUUID(), createdAt, updatedAt: createdAt, createdBy: by || creator, version: 1, ...fields };
    (data[entity] ||= []).push(r);
    return r;
  };
  /** Numbers a group like the app does: per-FY series (INV/26-27/0007) or a simple series (LD-0012), oldest first. */
  const number = (entity, prefix, fyField) => {
    const list = (data[entity] || []).slice().sort((a, b) => String(fyField ? a[fyField] : a.createdAt).localeCompare(String(fyField ? b[fyField] : b.createdAt)) || a.createdAt.localeCompare(b.createdAt));
    const seq = {};
    for (const r of list) {
      const fy = fyField ? financialYear(String(r[fyField])) : '';
      const key = fyField ? `${entity}:${fy}` : entity;
      const n = (seq[key] = (seq[key] || 0) + 1);
      r.number = fyField ? `${prefix}/${fy}/${String(n).padStart(4, '0')}` : `${prefix}-${String(n).padStart(4, '0')}`;
      r._numKey = key;
      r._seq = n;
    }
  };

  // ---------- users (admin comes from the UI; the rest share its password hash — they never sign in here)
  const U = (name, email, role) => ({ id: randomUUID(), name, email, role, active: true, salt: admin.salt, hash: admin.hash });
  const users = [
    U('Vikas Ranjan', 'vikas@suryoday.example', 'manager'),
    U('Priya Kumari', 'priya@suryoday.example', 'sales'),
    U('Aman Verma', 'aman@suryoday.example', 'sales'),
    U('Sunil Yadav', 'sunil@suryoday.example', 'technician'),
    U('Imran Ansari', 'imran@suryoday.example', 'technician'),
    U('Neha Gupta', 'neha@suryoday.example', 'accounts'),
  ];
  const [manager, sales1, sales2, tech1, tech2, accounts] = users;
  const salesUsers = [sales1, sales2];
  const techs = [tech1, tech2];

  // ---------- company settings
  const settings = {
    companyName: 'Suryoday Solar Solutions (Demo)', gstin: '10ABCDE1234F1Z5', pan: 'ABCDE1234F', state: 'Bihar',
    address: '2nd Floor, Demo Arcade, Boring Road\nPatna, Bihar 800001', phone: '+91 98765 43210', email: 'sales@suryoday.example',
    website: 'www.suryoday.example', bankName: 'Demo Bank — Boring Road branch (sample details)', accountNo: 'DEMO 0001 2345 6789',
    ifsc: 'DEMO0001234',
    quoteTerms: '50% advance with order, 40% on material delivery, 10% after commissioning.\nPrices valid for 15 days. Net-metering fees as per DISCOM actuals.\n25-year panel performance warranty, 5–10 year inverter warranty (manufacturer).',
    invoiceTerms: 'Payment due within 30 days. Please quote the invoice number with your payment.\nInterest @18% p.a. may be charged on overdue amounts.',
    paymentTermsDays: 30, autoAssignLeads: true, autoCreateCustomer: true,
    logo: admin.logo, signature: admin.signature, accentColor: '#0f6b5c', printTemplate: 'modern',
    tagline: 'Rooftop & commercial solar EPC · MNRE-listed vendor (demo)', upiId: 'suryoday.demo@okaxis', showUpiQr: true, showBankOnQuote: false,
    poTerms: 'Deliver to our Patna warehouse with invoice, packing list and test certificates.\nPayment within 30 days of receipt of material.',
    challanTerms: 'Material sent for installation at the site below. Not for sale. Please check quantities and sign on receipt.',
    declaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
    footerNote: 'Demo document generated for a product brochure — not a real company.',
    showSavingsOnQuote: true, unitsPerKwPerDay: 4.2, tariffPerUnit: 7.5,
  };
  add('_settings', settings, stamp(D(-245), 10));

  // ---------- products
  const P = {};
  const prod = (k, name, sku, category, brand, specs, warranty, unit, hsn, price, cost, gstRate, reorderLevel) => {
    P[k] = add('products', { name, sku, category, brand, specs, warranty, unit, hsn, price, cost, gstRate: String(gstRate), reorderLevel }, stamp(D(-244), 12));
  };
  prod('panel', 'Solar Panel 545 Wp Mono PERC Bifacial', 'SP-545-BF', 'Solar Panel', 'SunVolt', '545 Wp, 144 half-cut cells, bifacial, 21.1% efficiency', '25 years performance, 12 years product', 'Nos', '8541', 14200, 12450, 5, 40);
  prod('inv3', 'On-grid Inverter 3 kW', 'INV-OG-3K', 'Inverter', 'VoltEdge', '3 kW single-phase, 1 MPPT, Wi-Fi monitoring', '7 years', 'Nos', '8504', 24500, 21200, 5, 3);
  prod('inv5', 'On-grid Inverter 5 kW', 'INV-OG-5K', 'Inverter', 'VoltEdge', '5 kW single-phase, 2 MPPT, Wi-Fi monitoring', '7 years', 'Nos', '8504', 38500, 33600, 5, 3);
  prod('inv10', 'On-grid Inverter 10 kW (3-phase)', 'INV-OG-10K', 'Inverter', 'VoltEdge', '10 kW three-phase, 2 MPPT, RS485 + Wi-Fi', '10 years', 'Nos', '8504', 72000, 63500, 5, 2);
  prod('battery', 'Lithium Battery 5.12 kWh (LiFePO4)', 'BAT-LFP-5K', 'Battery', 'Helion', '51.2 V 100 Ah, 6000 cycles, built-in BMS', '10 years', 'Nos', '8507', 92000, 80500, 18, 2);
  prod('structure', 'GI Mounting Structure (per kW)', 'STR-GI-KW', 'Structure', 'Bihar Steel', 'Hot-dip galvanised, elevated, wind-load 150 km/h', '10 years', 'kW', '7308', 6500, 5150, 18, 15);
  prod('dc', 'DC Solar Cable 4 sq mm', 'CAB-DC-4', 'Cable', 'Ganga Cables', '4 sq mm tinned copper, UV-resistant, 1.5 kV DC', '10 years', 'Meter', '8544', 62, 47, 18, 300);
  prod('ac', 'AC Cable 6 sq mm Copper', 'CAB-AC-6', 'Cable', 'Ganga Cables', '6 sq mm 2-core copper armoured', '10 years', 'Meter', '8544', 145, 118, 18, 150);
  prod('acdb', 'ACDB / DCDB Combo Box', 'BOS-ACDC', 'BOS / Accessories', 'Eastern Switchgear', 'IP65, SPD + MCB + fuse, 1-string / 2-string', '2 years', 'Set', '8537', 7800, 6150, 18, 5);
  prod('earthing', 'Earthing Kit with Lightning Arrester', 'BOS-EARTH', 'BOS / Accessories', 'Eastern Switchgear', '3 chemical earth pits + ESE lightning arrester', '5 years', 'Set', '8535', 5400, 4100, 18, 5);
  prod('netmeter', 'Bi-directional Net Meter', 'MTR-NET-1P', 'BOS / Accessories', 'Metering Solutions', 'Single-phase, DISCOM approved, LT CT optional', '5 years', 'Nos', '9028', 8500, 7050, 18, 5);
  prod('install', 'Installation & Commissioning (per kW)', 'SRV-INST', 'Service', 'Suryoday', 'Structure erection, wiring, testing, DISCOM liaison', '5 years workmanship', 'kW', '995461', 4500, 2600, 18, 0);
  const line = (k, qty, extra = {}) => ({ productId: P[k].id, description: P[k].name, hsn: P[k].hsn, qty, unit: P[k].unit, rate: P[k].price, discountPct: 0, gstRate: Number(P[k].gstRate), ...extra });
  const costLine = (k, qty) => ({ ...line(k, qty), rate: P[k].cost });
  /** A complete rooftop kit for `kw` kilowatts, priced like a real EPC quote. */
  const kit = (kw, { battery = 0, service = true } = {}) => {
    const items = [line('panel', Math.ceil((kw * 1000) / 545))];
    let rest = kw;
    const invs = { inv10: 0, inv5: 0, inv3: 0 };
    while (rest > 7.5) { invs.inv10++; rest -= 10; }
    if (rest > 3.5) invs.inv5++; else if (rest > 0) invs.inv3++;
    for (const [k, n] of Object.entries(invs)) if (n) items.push(line(k, n));
    if (battery) items.push(line('battery', battery));
    const nInv = invs.inv10 + invs.inv5 + invs.inv3;
    items.push(line('structure', kw), line('dc', Math.round((20 + kw * 8) / 10) * 10), line('ac', Math.round((10 + kw * 2) / 5) * 5),
      line('acdb', nInv), line('earthing', Math.max(1, Math.ceil(kw / 10))), line('netmeter', 1));
    if (service) items.push(line('install', kw));
    return items;
  };

  // ---------- warehouses & vendors
  const whMain = add('warehouses', { name: 'Main Warehouse — Patna', location: 'Patliputra Industrial Area, Patna' }, stamp(D(-244), 10));
  const whSite = add('warehouses', { name: 'Site Store — Muzaffarpur', location: 'Bela Industrial Area, Muzaffarpur' }, stamp(D(-200), 10));
  const V = {};
  const vendor = (k, name, contactPerson, gstin, state, city, pincode, category, rating, contractEnd, address) => {
    V[k] = add('vendors', { name, contactPerson, phone: phone(), email: `orders@${k}.example`, gstin, state, city, pincode, category, rating, contractEnd, address }, stamp(D(-243), 15));
  };
  vendor('sunvolt', 'SunVolt Modules Pvt Ltd (Demo)', 'Kiran Desai', '24AAKCS5521M1Z8', 'Gujarat', 'Ahmedabad', '382445', 'Solar panels', 5, D(220), 'Plot 41, GIDC Phase II, Vatva');
  vendor('voltedge', 'VoltEdge Power Electronics (Demo)', 'Rahul Joshi', '27AADCV7732Q1Z2', 'Maharashtra', 'Pune', '411019', 'On-grid inverters', 4, D(160), 'Gat 118, Bhosari MIDC');
  vendor('helion', 'Helion Energy Storage (Demo)', 'Arjun Shetty', '29AAHCH4410L1Z6', 'Karnataka', 'Bengaluru', '560058', 'Lithium batteries', 4, D(300), 'Peenya Industrial Area, 2nd Stage');
  vendor('biharsteel', 'Bihar Steel Fabricators (Demo)', 'Sanjay Prasad', '10AAFFB2231C1Z9', 'Bihar', 'Patna', '800013', 'GI structures', 5, D(120), 'Fatuha Industrial Area');
  vendor('ganga', 'Ganga Cables & Wires (Demo)', 'Vivek Agarwal', '09AABFG6610D1Z4', 'Uttar Pradesh', 'Kanpur', '208022', 'DC / AC cables', 4, D(90), 'Panki Industrial Estate');
  vendor('eastern', 'Eastern Switchgear Co. (Demo)', 'Partha Ghosh', '19AAECE8871H1Z1', 'West Bengal', 'Kolkata', '700107', 'ACDB/DCDB, earthing', 3, D(45), 'Topsia Road South');
  vendor('metering', 'Metering Solutions India (Demo)', 'Nitin Bansal', '07AAJCM3348E1Z7', 'Delhi', 'New Delhi', '110020', 'Net meters', 4, D(200), 'Okhla Industrial Area Phase I');
  vendor('logistics', 'Patna Logistics & Transport (Demo)', 'Ram Babu Yadav', '10AAPFP9902K1Z3', 'Bihar', 'Patna', '800007', 'Transport', 4, D(150), 'Transport Nagar, Bypass Road');

  // ---------- purchase orders (+ stock in for received ones)
  const vendorProducts = { sunvolt: [['panel', 220]], voltedge: [['inv3', 8], ['inv5', 10], ['inv10', 4]], helion: [['battery', 6]], biharsteel: [['structure', 120]],
    ganga: [['dc', 2500], ['ac', 900]], eastern: [['acdb', 25], ['earthing', 25]], metering: [['netmeter', 25]] };
  const poPlan = [
    ['sunvolt', -232, 'Received', 1], ['voltedge', -228, 'Received', 1], ['biharsteel', -225, 'Received', 1], ['ganga', -222, 'Received', 1],
    ['eastern', -220, 'Received', 1], ['metering', -218, 'Received', 1], ['sunvolt', -120, 'Received', 0.6], ['helion', -95, 'Received', 1],
    ['voltedge', -40, 'Partially Received', 0.3], ['sunvolt', -12, 'Ordered', 0], ['biharsteel', -6, 'Ordered', 0], ['metering', -2, 'Draft', 0],
  ];
  const pos = poPlan.map(([vk, d, status, paidShare], i) => {
    const date = work(D(d));
    const scale = i >= 6 ? 0.7 : 1;
    const items = vendorProducts[vk].map(([pk, q]) => costLine(pk, Math.max(1, Math.round((q * scale) / 5) * 5 || q)));
    const interState = V[vk].state !== 'Bihar';
    const grandTotal = computeTotals(items, 0, interState).grandTotal;
    return add('purchaseOrders', {
      vendorId: V[vk].id, date, expectedDate: addDays(date, vk === 'sunvolt' ? 12 : 7), items, discount: 0, status,
      notes: i === 8 ? 'First lot of 3 kW inverters received; balance expected next week.' : '',
      stockReceived: status === 'Received', interState, grandTotal,
    }, stamp(date, 12, 30), manager.id);
  });
  number('purchaseOrders', 'PO', 'date');
  // Supplier payments: an advance when ordering and the rest after delivery (fixed references, so the random
  // sequence used by the rest of the data stays the same).
  poPlan.forEach(([vk, , , paidShare], i) => {
    if (!paidShare) return;
    const po = pos[i];
    const total = Math.round(po.grandTotal * paidShare);
    const parts = paidShare === 1 ? [[2, Math.round(total * 0.4)], [20, total - Math.round(total * 0.4)]] : [[i === 8 ? 3 : 10, total]];
    parts.forEach(([after, amount], k) => {
      const date = addDays(po.date, after);
      const mode = vk === 'biharsteel' && k === 1 ? 'Cheque' : 'Bank Transfer';
      add('supplierPayments', {
        purchaseOrderId: po.id, vendorId: po.vendorId, date, amount, mode,
        reference: `${mode === 'Cheque' ? 'CHQ' : 'UTR'}${String(731004200 + i * 37 + k * 11)}`,
        notes: k === 0 && parts.length > 1 ? 'Advance with the order' : '',
      }, stamp(date, 15, 10), accounts.id);
    });
  });
  number('supplierPayments', 'SP', 'date');
  const moves = []; // [date, productKey, dir, qty, extra]
  // Receipts are entries of their order (as "Receive goods" makes them), into the main warehouse.
  const receipt = (po) => ({ warehouseId: whMain.id, reason: 'Purchase receipt', sourceType: 'purchaseOrders', sourceId: po.id, reference: `PO ${po.number}` });
  for (const po of pos) {
    if (po.stockReceived) {
      for (const it of po.items) moves.push([po.expectedDate, it.productId, 'In', it.qty, receipt(po)]);
    } else if (po.status === 'Partially Received') {
      // "First lot of 3 kW inverters received": the first line has come, the rest is still due.
      const first = po.items[0];
      po.received = { [first.productId]: first.qty };
      moves.push([po.expectedDate, first.productId, 'In', first.qty, receipt(po)]);
    }
  }

  // ---------- customers
  // [name, city, state, pin, segment, lat, lng, gstinPan?]
  const CUST = [
    ['Ramesh Prasad Singh', 'Patna', 'Bihar', '800001', 'Residential', 25.611, 85.144],
    ['Anjali Sharma', 'Patna', 'Bihar', '800013', 'Residential', 25.621, 85.083],
    ['Shree Balaji Cold Storage', 'Hajipur', 'Bihar', '844101', 'Commercial', 25.686, 85.221, 'AAKFS4521K'],
    ['Manoj Kumar Mishra', 'Gaya', 'Bihar', '823001', 'Residential', 24.796, 85.003],
    ['Sunita Devi', 'Muzaffarpur', 'Bihar', '842001', 'Residential', 26.121, 85.390],
    ['Mithila Rice Mill', 'Darbhanga', 'Bihar', '846004', 'Industrial', 26.152, 85.897, 'AAGFM7310P'],
    ['Arvind Kumar Jha', 'Bhagalpur', 'Bihar', '812001', 'Residential', 25.244, 86.972],
    ['Gyan Jyoti Public School', 'Begusarai', 'Bihar', '851101', 'Commercial', 25.418, 86.130, 'AAATG2208R'],
    ['Hotel Pataliputra Grand (Demo)', 'Patna', 'Bihar', '800001', 'Commercial', 25.603, 85.137, 'AAHFH6612N'],
    ['Rajesh Ranjan', 'Patna', 'Bihar', '800014', 'Residential', 25.596, 85.091],
    ['Nalanda Agro Farms', 'Bihar Sharif', 'Bihar', '803101', 'Agriculture', 25.197, 85.523],
    ['Amit Kumar Mahto', 'Ranchi', 'Jharkhand', '834001', 'Residential', 23.344, 85.309],
    ['Steelcity Engineering Works', 'Jamshedpur', 'Jharkhand', '831001', 'Industrial', 22.805, 86.203, 'AAKFS1290B'],
    ['Priyanka Oraon', 'Ranchi', 'Jharkhand', '834002', 'Residential', 23.371, 85.330],
    ['Dhanbad Diagnostics Centre', 'Dhanbad', 'Jharkhand', '826001', 'Commercial', 23.795, 86.430, 'AAEFD4471G'],
    ['Alok Srivastava', 'Lucknow', 'Uttar Pradesh', '226001', 'Residential', 26.847, 80.947],
    ['Banaras Silk House', 'Varanasi', 'Uttar Pradesh', '221001', 'Commercial', 25.318, 82.974, 'AAFFB8832M'],
    ['Neeraj Tripathi', 'Kanpur', 'Uttar Pradesh', '208001', 'Residential', 26.449, 80.331],
    ['Lifeline Multispeciality Clinic', 'Noida', 'Uttar Pradesh', '201301', 'Commercial', 28.570, 77.321, 'AADCL5521H'],
    ['Vikram Singh Rathore', 'Jaipur', 'Rajasthan', '302001', 'Residential', 26.912, 75.787],
    ['Marudhar Handicrafts', 'Jodhpur', 'Rajasthan', '342001', 'Commercial', 26.238, 73.024, 'AAGFM3384L'],
    ['Hardik Patel', 'Ahmedabad', 'Gujarat', '380001', 'Residential', 23.022, 72.571],
    ['Navrang Textiles', 'Surat', 'Gujarat', '395003', 'Industrial', 21.170, 72.831, 'AAEFN7719C'],
    ['Sachin Kulkarni', 'Pune', 'Maharashtra', '411001', 'Residential', 18.520, 73.856],
    ['Vidarbha Agro Processing', 'Nagpur', 'Maharashtra', '440001', 'Industrial', 21.146, 79.088, 'AADCV2265F'],
    ['Meera Deshpande', 'Mumbai', 'Maharashtra', '400001', 'Residential', 18.940, 72.835],
    ['Sahyadri Vineyards', 'Nashik', 'Maharashtra', '422001', 'Agriculture', 19.997, 73.790],
    ['Karthik Rao', 'Bengaluru', 'Karnataka', '560001', 'Residential', 12.972, 77.594],
    ['Chamundi Silk Weavers', 'Mysuru', 'Karnataka', '570001', 'Commercial', 12.296, 76.639, 'AABAC6618K'],
    ['Lakshmi Narayanan', 'Chennai', 'Tamil Nadu', '600001', 'Residential', 13.083, 80.270],
    ['Kongu Spinning Mills', 'Coimbatore', 'Tamil Nadu', '641001', 'Industrial', 11.017, 76.956, 'AABCK9921E'],
    ['Srinivas Reddy', 'Hyderabad', 'Telangana', '500001', 'Residential', 17.385, 78.487],
    ['Subhashis Banerjee', 'Kolkata', 'West Bengal', '700001', 'Residential', 22.573, 88.364],
    ['Himalayan Tea Traders', 'Siliguri', 'West Bengal', '734001', 'Commercial', 26.727, 88.395, 'AAFFH2290Q'],
    ['Rakesh Chouhan', 'Bhopal', 'Madhya Pradesh', '462001', 'Residential', 23.259, 77.413],
    ['Malwa Dairy Products', 'Indore', 'Madhya Pradesh', '452001', 'Industrial', 22.720, 75.858, 'AAGCM1173J'],
    ['Ankit Malhotra', 'New Delhi', 'Delhi', '110001', 'Residential', 28.632, 77.219],
    ['Gurpreet Kaur', 'Chandigarh', 'Chandigarh', '160017', 'Residential', 30.741, 76.779],
    ['Bhaskar Bora', 'Guwahati', 'Assam', '781001', 'Residential', 26.144, 91.736],
    ['Sambit Mohanty', 'Bhubaneswar', 'Odisha', '751001', 'Residential', 20.296, 85.825],
    ['Joseph Thomas', 'Kochi', 'Kerala', '682011', 'Residential', 9.931, 76.267],
    ['Harjeet Singh Gill', 'Ludhiana', 'Punjab', '141001', 'Agriculture', 30.901, 75.857],
    ['Aravali Business Centre', 'Gurugram', 'Haryana', '122001', 'Commercial', 28.459, 77.026, 'AAFCA4402D'],
    ['Deepika Negi', 'Dehradun', 'Uttarakhand', '248001', 'Residential', 30.316, 78.032],
    ['Chhattisgarh Agro Foods', 'Raipur', 'Chhattisgarh', '492001', 'Industrial', 21.251, 81.629, 'AAECC5584N'],
    ['Venkata Ramana', 'Visakhapatnam', 'Andhra Pradesh', '530001', 'Residential', 17.686, 83.218],
    ['Sea Breeze Homestay', 'Panaji', 'Goa', '403001', 'Commercial', 15.490, 73.827],
    ['Rajiv Thakur', 'Shimla', 'Himachal Pradesh', '171001', 'Residential', 31.104, 77.173],
  ];
  const CODES = { Bihar: '10', Jharkhand: '20', 'Uttar Pradesh': '09', Rajasthan: '08', Gujarat: '24', Maharashtra: '27', Karnataka: '29', 'Tamil Nadu': '33', Telangana: '36', 'West Bengal': '19', 'Madhya Pradesh': '23', Delhi: '07', Haryana: '06', Chhattisgarh: '22', Odisha: '21' };
  const STREETS = ['Shastri Nagar', 'Kankarbagh', 'Rajendra Nagar', 'Civil Lines', 'Station Road', 'Gandhi Nagar', 'Ashok Nagar', 'MG Road', 'Nehru Colony', 'Sector 12', 'Main Bazaar', 'Industrial Area'];
  const customers = CUST.map(([name, city, state, pincode, segment, lat, lng, pan], i) => {
    const created = work(D(-238 + Math.round(i * 4.6)));
    const email = `${name.toLowerCase().replace(/\(demo\)/, '').replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`;
    return add('customers', {
      name, phone: phone(), email, city, state, pincode, segment,
      address: `${ri(3, 220)}, ${pick(STREETS)}`,
      gstin: pan && CODES[state] ? `${CODES[state]}${pan}1Z${'0123456789ABCDEFGHJK'[i % 20]}` : '',
      consumerNo: segment === 'Residential' || segment === 'Agriculture' ? `${ri(100, 999)}${ri(1000000, 9999999)}` : `HT/${ri(1000, 9999)}`,
      lifecycle: 'Prospect', _lat: lat, _lng: lng,
    }, stamp(created, ri(10, 17), ri(0, 59)), pick(salesUsers).id);
  });
  number('customers', 'CU');
  const C = (name) => customers.find((c) => c.name.startsWith(name));
  const interFor = (c) => c.state !== 'Bihar';

  // ---------- leads (60, every stage and source)
  const FIRST = ['Rahul', 'Pooja', 'Sanjay', 'Kavita', 'Deepak', 'Nisha', 'Vivek', 'Ritu', 'Ashok', 'Shalini', 'Mukesh', 'Rekha', 'Gaurav', 'Swati', 'Pankaj', 'Archana', 'Rohan', 'Madhuri', 'Santosh', 'Jyoti', 'Abhishek', 'Seema', 'Nitin', 'Komal'];
  const LAST = ['Kumar', 'Singh', 'Sinha', 'Prasad', 'Verma', 'Gupta', 'Jha', 'Mishra', 'Choudhary', 'Pandey', 'Yadav', 'Agarwal'];
  const LEAD_CITIES = [['Patna', 'Bihar', '800020'], ['Patna', 'Bihar', '800025'], ['Gaya', 'Bihar', '823002'], ['Muzaffarpur', 'Bihar', '842002'], ['Bhagalpur', 'Bihar', '812002'],
    ['Purnia', 'Bihar', '854301'], ['Arrah', 'Bihar', '802301'], ['Ranchi', 'Jharkhand', '834008'], ['Lucknow', 'Uttar Pradesh', '226010'], ['Varanasi', 'Uttar Pradesh', '221005'],
    ['Kolkata', 'West Bengal', '700091'], ['Jaipur', 'Rajasthan', '302017'], ['Pune', 'Maharashtra', '411045'], ['Bhopal', 'Madhya Pradesh', '462016'], ['Delhi', 'Delhi', '110092']];
  const SRC_W = ['Website', 'Referral', 'Facebook', 'WhatsApp', 'Website', 'Google', 'Referral', 'Walk-in', 'Instagram', 'Website', 'Call', 'Referral', 'Facebook', 'Exhibition', 'Google', 'WhatsApp', 'Website', 'Referral', 'Other', 'Facebook'];
  const SOURCES = ['Website', 'Walk-in', 'Referral', 'Facebook', 'Instagram', 'Google', 'WhatsApp', 'Call', 'Exhibition', 'Other'];
  const stagePlan = [['New', 10], ['Contacted', 9], ['Site Survey', 8], ['Proposal Sent', 9], ['Negotiation', 7], ['Won', 12], ['Lost', 5]];
  const leads = [];
  let li = 0;
  const wonCustomers = ['Ramesh Prasad', 'Anjali', 'Manoj Kumar', 'Sunita', 'Arvind', 'Rajesh', 'Amit Kumar', 'Alok', 'Vikram', 'Sachin', 'Karthik', 'Hardik'].map(C);
  for (const [status, n] of stagePlan) {
    for (let k = 0; k < n; k++, li++) {
      // Newer stages get newer leads; closed ones are older.
      const age = { New: [0, 12], Contacted: [5, 30], 'Site Survey': [12, 45], 'Proposal Sent': [20, 70], Negotiation: [25, 90], Won: [60, 212], Lost: [40, 200] }[status];
      const created = D(-ri(age[0], age[1]));
      const cust = status === 'Won' ? wonCustomers[k] : null;
      const [city, state, pincode] = cust ? [cust.city, cust.state, cust.pincode] : LEAD_CITIES[li % LEAD_CITIES.length];
      const kw = cust ? null : pick([2, 3, 3, 4, 5, 5, 6, 8, 10, 15, 25]);
      const segment = kw && kw >= 15 ? pick(['Commercial', 'Industrial']) : 'Residential';
      const nm = cust ? cust.name : `${FIRST[(li * 7) % FIRST.length]} ${LAST[(li * 5) % LAST.length]}`;
      const open = !['Won', 'Lost'].includes(status);
      let follow = '';
      if (open) {
        const off = li === 3 || li === 40 ? -1 : li % 11 === 0 ? 0 : ri(1, 21);
        follow = `${D(off)}T${String(pick([10, 11, 12, 15, 16, 17])).padStart(2, '0')}:${pick(['00', '30'])}`;
      }
      const capacityKw = cust ? (k < 3 ? 5 : k < 6 ? 3 : pick([3, 4, 5, 6])) : kw;
      const l = add('leads', {
        name: nm, phone: cust ? cust.phone : phone(), email: cust ? cust.email : (li % 3 ? `${nm.toLowerCase().replace(/\s+/g, '.')}@example.com` : ''),
        city, state, pincode, address: '', source: SRC_W[(li * 7) % SRC_W.length], segment: cust ? cust.segment : segment,
        capacityKw, monthlyBill: Math.round((capacityKw * 650 + ri(-300, 900)) / 50) * 50, status,
        assignedTo: status === 'New' && k === 0 ? undefined : salesUsers[li % 2].id, nextFollowUp: follow,
        notes: { New: 'Enquiry for rooftop solar. Wants subsidy details.', Contacted: 'Shared PM Surya Ghar subsidy brochure on WhatsApp.', 'Site Survey': 'Survey to check roof shadow from water tank.', 'Proposal Sent': 'Sent quotation with savings estimate.', Negotiation: 'Asking for 3% discount and EMI option.', Won: 'Advance received. Project created.', Lost: pick(['Went with a cheaper local installer.', 'Postponed — roof repair needed first.', 'Budget not approved this year.']) }[status],
        customerId: cust ? cust.id : undefined,
      }, stamp(created, ri(9, 19), ri(0, 59)), pick(salesUsers).id);
      if (!l.assignedTo) delete l.assignedTo;
      if (!l.customerId) delete l.customerId;
      leads.push(l);
    }
  }
  number('leads', 'LD');
  const leadOf = (c) => leads.find((l) => l.customerId === c.id);

  // ---------- activities
  const ACT = [['Call', 'Intro call — explained on-grid vs hybrid'], ['WhatsApp', 'Sent sample quotation and subsidy details'], ['Visit', 'Office visit with family'], ['Meeting', 'Discussed EMI options with bank'], ['Call', 'Follow-up on site survey slot'], ['Email', 'Shared datasheets of panels and inverter'], ['Note', 'Customer prefers bifacial panels']];
  leads.filter((l) => !['New'].includes(l.status)).slice(0, 26).forEach((l, i) => {
    const [type, subject] = ACT[i % ACT.length];
    const when = addDays(l.createdAt.slice(0, 10), ri(1, 6));
    if (when > TODAY) return;
    add('activities', { subject, type, leadId: l.id, customerId: l.customerId, when: `${when}T${String(ri(10, 18)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`, details: `${subject}. Next step agreed with ${l.name.split(' ')[0]}.` }, stamp(when, 18), l.assignedTo || sales1.id);
  });
  for (const a of data.activities) if (!a.customerId) delete a.customerId;

  // ---------- site surveys
  const surveyLeads = leads.filter((l) => ['Site Survey', 'Proposal Sent', 'Negotiation', 'Won'].includes(l.status));
  surveyLeads.slice(0, 22).forEach((l, i) => {
    const scheduled = l.status === 'Site Survey' && i % 2 === 0;
    const date = scheduled ? work(D(ri(1, 6))) : work(addDays(l.createdAt.slice(0, 10), ri(2, 8)));
    const kw = Number(l.capacityKw) || 5;
    add('surveys', {
      leadId: l.id, surveyDate: date > TODAY && !scheduled ? TODAY : date, surveyor: techs[i % 2].id,
      roofType: pick(['RCC', 'RCC', 'RCC', 'Tin Shed', 'Ground Mount']), roofAreaSqft: Math.round(kw * 100 + ri(50, 400)),
      shading: pick(['None', 'None', 'Partial']), sanctionedLoadKw: Math.max(2, kw - pick([0, 1, 2])), recommendedKw: kw,
      status: scheduled ? 'Scheduled' : i === 7 ? 'Cancelled' : 'Completed',
      remarks: scheduled ? 'Customer to keep terrace key ready.' : 'South-facing roof, minor shadow from water tank in winter mornings. Elevated structure recommended.',
    }, stamp(date, 9), l.assignedTo);
  });
  number('surveys', 'SS');

  // ---------- projects
  // [customer, kW, stage, startDaysAgo, battery]
  const PROJ = [
    ['Ramesh Prasad', 5, 'Handover', 205], ['Hotel Pataliputra', 30, 'Handover', 190], ['Amit Kumar', 3, 'Handover', 170],
    ['Mithila Rice', 40, 'Handover', 150], ['Alok', 3, 'Handover', 128], ['Anjali', 5, 'Handover', 110, 1],
    ['Manoj Kumar', 3, 'Net Metering', 84], ['Vikram', 4, 'Net Metering', 75], ['Sunita', 3, 'Testing', 60],
    ['Shree Balaji', 25, 'Installation', 48], ['Arvind', 5, 'Installation', 40], ['Karthik', 6, 'Installation', 36],
    ['Gyan Jyoti', 15, 'Material Procurement', 22], ['Sachin', 5, 'Material Procurement', 18], ['Rajesh', 3, 'Design', 12],
    ['Hardik', 8, 'Design', 9], ['Nalanda Agro', 10, 'Planning', 5], ['Dhanbad Diagnostics', 10, 'On Hold', 70],
  ];
  const STAGES = ['Planning', 'Design', 'Material Procurement', 'Installation', 'Testing', 'Net Metering', 'Handover'];
  const MILESTONES = ['Site survey done', 'Design approved', 'Material procured', 'Installation done', 'Testing & QA', 'Net meter installed', 'Handover'];
  const PROGRESS = { Planning: 10, Design: 22, 'Material Procurement': 38, Installation: 58, Testing: 78, 'Net Metering': 88, Handover: 100, 'On Hold': 30 };
  const quotes = [];
  const projects = PROJ.map(([cn, kw, stage, ago, battery], i) => {
    const c = C(cn);
    const start = work(D(-ago));
    const span = kw >= 25 ? 55 : 35;
    let due = addDays(start, span);
    if (stage !== 'Handover' && due <= TODAY) due = D(6 + i * 2);
    if (stage === 'Installation' && i === 10) due = D(-3); // one delayed project (alert)
    const items = kit(kw, { battery: battery || 0 });
    const inter = interFor(c);
    const discount = kw >= 25 ? Math.round(kw * 900 / 100) * 100 : pick([0, 2000, 3000, 5000]);
    const tot = computeTotals(items, discount, inter);
    const sIdx = stage === 'On Hold' ? 2 : STAGES.indexOf(stage);
    const milestones = MILESTONES.slice(0, stage === 'Handover' ? 7 : sIdx + (stage === 'Material Procurement' ? 0 : 0) + 1).slice(0, stage === 'Handover' ? 7 : Math.max(1, sIdx + 1));
    const costPct = 0.78;
    const pr = add('projects', {
      name: `${c.segment === 'Residential' ? c.name.split(' ').slice(-1)[0] + ' Residence' : c.name.replace(' (Demo)', '')} — ${kw} kW ${battery ? 'Hybrid' : 'On-grid'}`,
      customerId: c.id, capacityKw: kw, stage, manager: i % 3 === 0 ? manager.id : admin.id, startDate: start, dueDate: due,
      budget: Math.round(tot.taxable * costPct / 1000) * 1000,
      actualCost: Math.round(tot.taxable * costPct * Math.min(1, PROGRESS[stage] / 100 + 0.05) * (0.96 + rnd() * 0.08) / 100) * 100,
      progress: PROGRESS[stage], milestones,
      notes: stage === 'On Hold' ? 'Customer asked to pause until the new floor is constructed.' : stage === 'Net Metering' ? 'Net-meter application submitted to DISCOM; inspection awaited.' : '',
    }, stamp(start, 12), manager.id);
    c.lifecycle = stage === 'Handover' ? 'Installed' : 'Active Project';
    // the quotation that won the deal
    const qDate = work(addDays(start, -ri(6, 15)));
    const q = add('quotations', {
      customerId: c.id, leadId: leadOf(c)?.id, date: qDate, validTill: addDays(qDate, 15), systemKw: kw, placeOfSupply: c.state,
      items, discount, status: 'Accepted', terms: '', interState: inter, grandTotal: tot.grandTotal,
    }, stamp(qDate, 15), leadOf(c)?.assignedTo || sales1.id);
    if (!q.leadId) delete q.leadId;
    quotes.push(q);
    pr._quote = q; pr._items = items; pr._discount = discount; pr._total = tot.grandTotal; pr._customer = c; pr._battery = battery;
    return pr;
  });

  // other quotations: open, rejected, expired — for prospects
  const prospects = ['Steelcity', 'Priyanka', 'Banaras', 'Neeraj', 'Lifeline', 'Marudhar', 'Navrang', 'Vidarbha', 'Meera', 'Lakshmi', 'Srinivas', 'Rakesh', 'Ankit', 'Aravali', 'Gurpreet'].map(C);
  const qPlan = ['Sent', 'Sent', 'Sent', 'Sent', 'Sent', 'Sent', 'Draft', 'Draft', 'Draft', 'Rejected', 'Rejected', 'Expired', 'Expired', 'Expired', 'Sent'];
  prospects.forEach((c, i) => {
    const status = qPlan[i];
    const kw = c.segment === 'Residential' ? pick([3, 4, 5, 6]) : pick([12, 15, 20, 25, 35]);
    const ago = { Sent: ri(2, 14), Draft: ri(0, 4), Rejected: ri(30, 90), Expired: ri(40, 150) }[status];
    const date = work(D(-ago));
    const items = kit(kw, { battery: i === 8 ? 2 : 0 });
    const discount = kw >= 12 ? Math.round(kw * 700 / 100) * 100 : pick([0, 0, 2500]);
    const inter = interFor(c);
    quotes.push(add('quotations', {
      customerId: c.id, date, validTill: addDays(date, 15), systemKw: kw, placeOfSupply: c.state, items, discount, status,
      terms: '', interState: inter, grandTotal: computeTotals(items, discount, inter).grandTotal,
    }, stamp(date, 16), pick(salesUsers).id));
  });
  number('quotations', 'QT', 'date');

  // ---------- invoices & payments
  const invoices = [];
  const pays = [];
  const MODES = ['UPI', 'Bank Transfer', 'Cheque', 'Bank Transfer', 'UPI'];
  const LOAN_PAID = new Set(['Ramesh Prasad Singh', 'Amit Kumar Mahto', 'Anjali Sharma', 'Alok Srivastava']);
  const invoice = (c, date, items, discount, project, quote, plan, notes = '', dueDays = 30) => {
    const inter = interFor(c);
    const tot = computeTotals(items, discount, inter).grandTotal;
    const inv = add('invoices', {
      customerId: c.id, projectId: project?.id, date, dueDate: addDays(date, dueDays), placeOfSupply: c.state, items, discount,
      status: 'Sent', notes, interState: inter, grandTotal: tot,
    }, stamp(date, 13), accounts.id);
    if (!inv.projectId) delete inv.projectId;
    if (quote) quote.invoiceId = inv.id;
    invoices.push(inv);
    // Payments never exceed the total; the last tranche is the exact balance.
    const pay = (d, amount, mode, kind = 'Payment') => {
      if (d > TODAY) d = TODAY;
      pays.push(add('payments', { invoiceId: inv.id, date: d, amount, mode, kind, reference: mode === 'Cash' ? '' : `${mode === 'Cheque' ? 'CHQ' : 'UTR'}${ri(100000000, 999999999)}` }, stamp(d, 16), accounts.id));
    };
    const r1000 = (x) => Math.round(x / 1000) * 1000;
    if (plan === 'full') {
      const a = r1000(tot * 0.5); const b = r1000(tot * 0.4);
      pay(date, a, pick(MODES), 'Advance');
      pay(addDays(date, ri(6, 14)), b, LOAN_PAID.has(c.name) ? 'Loan Disbursal' : pick(MODES));
      pay(addDays(date, ri(18, 28)), round2(tot - a - b), pick(MODES));
    } else if (plan === 'full1') {
      pay(addDays(date, ri(2, 12)), tot, pick(MODES));
    } else if (plan === 'partial') {
      pay(date, r1000(tot * pick([0.4, 0.5, 0.6])), pick(MODES), 'Advance');
    } else if (plan === 'partial2') {
      const a = r1000(tot * 0.5);
      pay(date, a, pick(MODES), 'Advance');
      pay(addDays(date, ri(5, 10)), r1000(tot * 0.3), pick(MODES));
    }
    return inv;
  };
  // project invoices: raised when material reaches site
  const projInvPlan = { Handover: 'full', 'Net Metering': 'full', Testing: 'partial2', Installation: 'partial' };
  projects.forEach((pr, i) => {
    const plan = projInvPlan[pr.stage];
    if (!plan) return;
    let date = work(addDays(pr.startDate, pr.stage === 'Installation' ? 6 : 10));
    if (date > TODAY) date = TODAY;
    let p = plan;
    if (pr.stage === 'Installation' && i === 10) p = 'unpaid'; // waiting for the bank loan
    const milestoneTerms = ['Installation', 'Testing'].includes(pr.stage);
    pr._invoice = invoice(pr._customer, date, pr._items, pr._discount, pr, pr._quote, p,
      `From quotation ${pr._quote.number}${milestoneTerms ? '. Balance as per milestones: 40% on delivery, 10% after commissioning.' : ''}`, milestoneTerms ? 60 : 30);
  });
  // supply, retrofit and upgrade invoices (no project)
  const OTHER_INV = [
    ['Steelcity', 210, [['panel', 40], ['inv10', 2], ['dc', 400]], 'full1'],
    ['Banaras', 196, [['panel', 12], ['inv5', 1], ['structure', 6]], 'full1'],
    ['Navrang', 182, [['panel', 60], ['inv10', 3]], 'full'],
    ['Kongu', 160, [['panel', 36], ['inv10', 2], ['acdb', 2]], 'full'],
    ['Malwa', 140, [['panel', 24], ['inv10', 1], ['inv3', 1]], 'full1'],
    ['Joseph', 118, [['battery', 1], ['install', 1]], 'full1'],
    ['Subhashis', 101, [['battery', 2], ['install', 2]], 'full1'],
    ['Chhattisgarh', 86, [['panel', 30], ['inv10', 1], ['dc', 300]], 'full'],
    ['Aravali', 54, [['panel', 20], ['inv10', 1], ['structure', 10], ['install', 10]], 'partial'], // overdue
    ['Venkata', 33, [['inv5', 1], ['install', 1]], 'full1'],
    ['Bhaskar', 20, [['battery', 1], ['install', 1]], 'partial'],
    ['Vidarbha', 9, [['panel', 30], ['inv10', 1], ['ac', 120]], 'unpaid'],
    ['Lifeline', 3, [['panel', 18], ['inv10', 1], ['acdb', 1], ['earthing', 1], ['netmeter', 1]], 'unpaid'],
  ];
  for (const [cn, ago, lines, plan] of OTHER_INV) {
    const c = C(cn);
    const date = work(D(-ago));
    const items = lines.map(([k, q]) => line(k, q, k === 'install' && q <= 2 ? { description: 'Battery / inverter installation & wiring', unit: 'Job', rate: 3500 } : {}));
    const inv = invoice(c, date, items, 0, null, null, plan, ago > 100 ? 'Supply only — installation by customer’s own electrician.' : '');
    if (c.lifecycle === 'Prospect') c.lifecycle = 'Installed';
    // goods leave the warehouse with the invoice
    for (const it of items) if (it.productId !== P.install.id) moves.push([date, it.productId, 'Out', it.qty, { warehouseId: whMain.id, reason: 'Sale (supply only)', reference: `INV ${'pending'}`, _inv: inv }]);
  }
  number('invoices', 'INV', 'date');
  number('payments', 'RC', 'date');
  for (const m of moves) if (m[4]._inv) { m[4].reference = `INV ${m[4]._inv.number}`; delete m[4]._inv; }
  for (const q of quotes) if (!q.invoiceId) delete q.invoiceId;

  // ---------- delivery challans (material to project sites)
  const vehicles = ['BR01 GK 4521', 'BR01 HB 7710', 'BR06 PA 3394', 'JH01 CQ 2280'];
  projects.forEach((pr, i) => {
    const sIdx = STAGES.indexOf(pr.stage);
    if (sIdx < 2) return;
    const mp = pr.stage === 'Material Procurement';
    let date = work(addDays(pr.startDate, mp ? 14 : 8));
    if (date > TODAY) date = TODAY;
    const status = mp ? (i === 12 ? 'Draft' : 'Dispatched') : 'Delivered';
    const items = pr._items.filter((it) => it.productId !== P.install.id);
    const inter = interFor(pr._customer);
    const dc = add('dispatches', {
      projectId: pr.id, customerId: pr.customerId, warehouseId: pr._customer.city === 'Muzaffarpur' ? whSite.id : whMain.id, date,
      vehicleNo: vehicles[i % vehicles.length], transporter: 'Patna Logistics & Transport — driver Ram Babu', items, status,
      notes: 'Unload at site; customer to provide storage for panels.', stockIssued: status !== 'Draft', ...(status !== 'Draft' ? { issuedMoves: true } : {}), interState: inter,
      grandTotal: computeTotals(items, 0, inter).grandTotal,
    }, stamp(date, 8, 30), manager.id);
    pr._dc = dc;
  });
  number('dispatches', 'DC', 'date');
  for (const pr of projects) {
    if (!pr._dc || !pr._dc.stockIssued) continue;
    const dc = pr._dc;
    // The Muzaffarpur store only holds what was moved there from Patna: a transfer the day before the challan.
    if (dc.warehouseId === whSite.id) {
      const day = addDays(dc.date, -1);
      for (const it of dc.items) {
        const t = { reason: 'Transfer', sourceType: 'transfer', sourceId: randomUUID(), reference: `Patna → Muzaffarpur for DC ${dc.number}` };
        moves.push([day, it.productId, 'Out', it.qty, { ...t, warehouseId: whMain.id }]);
        moves.push([day, it.productId, 'In', it.qty, { ...t, warehouseId: whSite.id }]);
      }
    }
    for (const it of dc.items) moves.push([dc.date, it.productId, 'Out', it.qty, { warehouseId: dc.warehouseId, projectId: pr.id, reason: 'Delivery to site', sourceType: 'dispatches', sourceId: dc.id, reference: `DC ${dc.number}` }]);
  }

  // ---------- stock: opening balances sized so stock never dips below zero
  const OPEN_DATE = D(-240);
  const buffer = { netmeter: 3, inv10: 1, battery: 3 };
  for (const [k, p] of Object.entries(P)) {
    if (p.category === 'Service') continue;
    const mine = moves.filter((m) => m[1] === p.id).sort((a, b) => a[0].localeCompare(b[0]) || (a[2] === 'In' ? -1 : 1));
    let run = 0, min = 0;
    for (const m of mine) { run += (m[2] === 'In' ? 1 : -1) * m[3]; min = Math.min(min, run); }
    const extra = buffer[k] ?? Math.max(Number(p.reorderLevel) * 2, 10);
    const qty = Math.ceil(-min + extra);
    if (qty > 0) moves.unshift([OPEN_DATE, p.id, 'In', qty, { warehouseId: whMain.id, reference: 'Opening stock' }]);
  }
  moves.sort((a, b) => a[0].localeCompare(b[0]) || (a[2] === 'In' ? -1 : 1));
  for (const [date, productId, direction, qty, extra] of moves) {
    const m = add('stockMoves', { productId, direction, qty, date, ...extra, serials: '' }, stamp(date, direction === 'In' ? 11 : 9), direction === 'In' ? accounts.id : manager.id);
    if (productId === P.panel.id && direction === 'Out' && extra.projectId) m.serials = Array.from({ length: Math.min(qty, 4) }, (_, j) => `SV545B${ri(2600000, 2699999)}${j}`).join(', ') + (qty > 4 ? ', …' : '');
    if (!m.serials) delete m.serials;
  }
  number('stockMoves', 'SM');
  // sanity check: running stock never negative — in total, and in each warehouse
  for (const p of Object.values(P)) {
    let run = 0;
    const per = {};
    for (const m of data.stockMoves.filter((x) => x.productId === p.id)) {
      const d = (m.direction === 'Out' ? -1 : 1) * m.qty;
      run += d; per[m.warehouseId || ''] = (per[m.warehouseId || ''] || 0) + d;
      if (run < 0) throw new Error(`stock negative for ${p.name}`);
      if (per[m.warehouseId || ''] < 0) throw new Error(`stock negative for ${p.name} in a warehouse`);
    }
  }

  // ---------- installations
  const doneChecklist = ['Structure mounted', 'Panels fixed', 'Inverter installed', 'DC & AC cabling', 'Earthing & lightning arrester', 'System tested', 'Customer briefed'];
  projects.forEach((pr, i) => {
    const sIdx = STAGES.indexOf(pr.stage);
    if (sIdx < 2) return;
    const c = pr._customer;
    let status, date, checklist;
    if (sIdx >= 4) { status = 'Completed'; date = work(addDays(pr.startDate, 16)); checklist = doneChecklist; }
    else if (sIdx === 3) {
      if (i === 9) { status = 'In Progress'; date = TODAY; checklist = doneChecklist.slice(0, 3); }
      else if (i === 10) { status = 'Delayed'; date = work(D(-4)); checklist = doneChecklist.slice(0, 1); }
      else { status = 'Scheduled'; date = work(D(2)); checklist = []; }
    } else { status = 'Scheduled'; date = work(D(6 + i)); checklist = []; }
    const done = status === 'Completed';
    const inst = add('installations', {
      projectId: pr.id, scheduledDate: date > TODAY && done ? TODAY : date, technician: techs[i % 2].id,
      team: pick(['Deepak Kumar, Ravi Paswan', 'Ravi Paswan, Manoj Thakur', 'Deepak Kumar, Sonu Kumar']), status, checklist,
      siteLat: done ? round2((c._lat + (rnd() - 0.5) * 0.02) * 10000) / 10000 : undefined, siteLng: done ? round2((c._lng + (rnd() - 0.5) * 0.02) * 10000) / 10000 : undefined,
      customerConfirmed: done, customerRating: done ? pick([4, 5, 5]) : undefined,
      remarks: status === 'Delayed' ? 'Delayed: structure fabrication for elevated roof took 3 extra days.' : done ? 'System generating as expected. Customer shown the monitoring app.' : '',
    }, stamp(addDays(pr.startDate, 3), 10), manager.id);
    for (const k of ['siteLat', 'siteLng', 'customerRating']) if (inst[k] === undefined) delete inst[k];
    if (done) { c.lat = inst.siteLat; c.lng = inst.siteLng; }
    pr._inst = inst;
  });
  number('installations', 'IN');

  // ---------- tasks
  const TASK_T = [
    ['Prepare single-line diagram', 1], ['Get design approval from customer', 1], ['Raise PO for panels & inverter', 2], ['Structure fabrication at site', 3],
    ['Schedule installation team', 3], ['Upload commissioning report on PM Surya Ghar portal', 5], ['Apply for net meter with DISCOM', 5],
    ['Collect balance payment', 6], ['Customer handover & app training', 6], ['Arrange crane for panel lifting', 3], ['Earthing pit testing', 4], ['Monitoring Wi-Fi setup', 4],
  ];
  const statusFor = (stageIdx, need) => (stageIdx > need ? 'Done' : stageIdx === need ? pick(['In Progress', 'Review', 'To Do']) : 'To Do');
  let tn = 0;
  projects.forEach((pr, pi) => {
    const sIdx = pr.stage === 'On Hold' ? 2 : STAGES.indexOf(pr.stage);
    if (pr.stage === 'Handover' && pi > 1) return;
    for (const [title, need] of [0, 1, 2].map((j) => TASK_T[(pi * 5 + j * 4) % TASK_T.length])) {
      tn++;
      const status = pr.stage === 'Handover' ? 'Done' : statusFor(sIdx, need);
      const due = status === 'Done' ? addDays(pr.startDate, need * 5) : tn === 9 ? D(-1) : D(((tn * 7) % 25) + 1);
      add('tasks', {
        title, projectId: pr.id, assignee: [manager, tech1, tech2, sales1, accounts][tn % 5].id,
        priority: tn % 7 === 0 ? 'Urgent' : tn % 3 === 0 ? 'High' : tn % 4 === 0 ? 'Low' : 'Medium',
        status, dueDate: due, description: `${title} for ${pr.name}.`,
      }, stamp(pr.startDate, 14), manager.id);
    }
  });
  for (const [title, off, who] of [['Renew trade licence', 9, admin], ['Monthly GST return data to CA', 6, accounts], ['Solar expo stall booking', 18, sales2], ['Inventory count — Patna warehouse', 12, manager], ['Team safety training (working at height)', 15, manager]]) {
    tn++;
    add('tasks', { title, assignee: who.id, priority: 'Medium', status: 'To Do', dueDate: D(off), description: '' }, stamp(D(-3), 10), admin.id);
  }
  number('tasks', 'TK');

  // ---------- subsidies (PM Surya Ghar: ₹30,000/kW up to 2 kW, ₹18,000 for the 3rd kW, max ₹78,000)
  const pmsg = (kw) => Math.min(78000, Math.min(kw, 2) * 30000 + (kw > 2 ? 18000 : 0));
  const SUBS = [['Ramesh Prasad', 'Disbursed'], ['Amit Kumar', 'Disbursed'], ['Alok', 'Disbursed'], ['Anjali', 'Approved'], ['Manoj Kumar', 'Under Review'],
    ['Vikram', 'Documents Verified'], ['Sunita', 'Under Review'], ['Arvind', 'Applied'], ['Karthik', 'Applied'], ['Sachin', 'Documents Verified'], ['Rajesh', 'Applied'], ['Priyanka', 'Rejected']];
  const DOCS = ['Aadhaar', 'Electricity bill', 'Bank passbook / cheque', 'Site photo', 'Net meter agreement', 'Commissioning report'];
  const docsFor = { Applied: 3, 'Documents Verified': 4, 'Under Review': 5, Approved: 6, Disbursed: 6, Rejected: 2 };
  SUBS.forEach(([cn, status], i) => {
    const c = C(cn);
    const pr = projects.find((p) => p.customerId === c.id);
    const kw = pr ? pr.capacityKw : 3;
    const applied = pr ? work(addDays(pr.startDate, ['Applied', 'Documents Verified'].includes(status) ? 2 : 20)) : work(D(-60));
    add('subsidies', {
      customerId: c.id, scheme: 'PM Surya Ghar', applicationNo: `NP-${c.state === 'Bihar' ? 'BR' : c.state.slice(0, 2).toUpperCase()}${ri(10, 99)}-${ri(1000000, 9999999)}`,
      capacityKw: kw, amount: pmsg(kw), appliedOn: applied > TODAY ? TODAY : applied, status, docs: DOCS.slice(0, docsFor[status]),
      remarks: status === 'Rejected' ? 'Rejected: name on electricity bill does not match Aadhaar. Re-apply after correction.' : status === 'Disbursed' ? 'Subsidy credited to customer’s bank account.' : '',
    }, stamp(applied > TODAY ? TODAY : applied, 15), sales1.id);
  });
  number('subsidies', 'SB');

  // ---------- loans
  const LOANS = [['Ramesh Prasad', 'State Bank of India', 220000, 7, 120, 'Repaying'], ['Amit Kumar', 'Bank of Baroda', 150000, 7.15, 84, 'Repaying'],
    ['Anjali', 'Punjab National Bank', 260000, 7, 120, 'Disbursed'], ['Manoj Kumar', 'Canara Bank', 140000, 8.15, 60, 'Approved'],
    ['Arvind', 'State Bank of India', 230000, 7, 120, 'Verification'], ['Karthik', 'HDFC Bank', 300000, 10.5, 60, 'Submitted'],
    ['Alok', 'Bank of Baroda', 160000, 7.15, 84, 'Closed'], ['Priyanka', 'Union Bank of India', 180000, 9.25, 72, 'Rejected']];
  const LDOCS = ['Personal details', 'Income proof', 'KYC', 'Bank statement', 'Quotation'];
  LOANS.forEach(([cn, bank, amount, ratePct, tenureMonths, status], i) => {
    const c = C(cn);
    const pr = projects.find((p) => p.customerId === c.id);
    const created = pr ? addDays(pr.startDate, -3) : D(-50);
    const first = ['Repaying', 'Disbursed', 'Closed'].includes(status) ? `${addDays(created, 45).slice(0, 8)}05` : '';
    add('loans', {
      customerId: c.id, bank, amount, ratePct, tenureMonths, firstEmiDate: first, status,
      docs: status === 'Submitted' ? LDOCS.slice(0, 3) : LDOCS,
      remarks: status === 'Closed' ? 'Customer pre-closed the loan.' : status === 'Rejected' ? 'Low CIBIL score; customer opted to pay directly.' : '',
    }, stamp(created, 12), sales2.id);
  });
  for (const l of data.loans) if (!l.firstEmiDate) delete l.firstEmiDate;
  number('loans', 'LN');

  // ---------- tickets
  const TK = [
    ['Inverter tripped — no generation since morning', 'Hotel Pataliputra', 'Breakdown', 'Urgent', 'Assigned', 0, ''],
    ['Low generation after monsoon', 'Ramesh Prasad', 'Complaint', 'High', 'In Progress', 2, ''],
    ['Quarterly panel cleaning', 'Mithila Rice', 'Cleaning', 'Medium', 'Open', 5, ''],
    ['Net meter reading mismatch with bill', 'Amit Kumar', 'Query', 'Medium', 'Open', 4, ''],
    ['AMC visit — Q3 health check', 'Alok', 'AMC Visit', 'Low', 'Assigned', 9, ''],
    ['Wi-Fi monitoring offline', 'Anjali', 'Complaint', 'Medium', 'Resolved', -6, 'Router password had changed. Re-paired the inverter Wi-Fi stick.'],
    ['Earthing resistance check', 'Hotel Pataliputra', 'AMC Visit', 'Low', 'Closed', -20, 'Measured 1.8 Ω on all pits. Within limits.'],
    ['Bird nesting under panels', 'Ramesh Prasad', 'Complaint', 'Medium', 'Closed', -35, 'Installed bird-proofing mesh around the array.'],
    ['Battery backup time reduced', 'Joseph', 'Breakdown', 'High', 'In Progress', 1, ''],
    ['How to read generation in the app?', 'Subhashis', 'Query', 'Low', 'Resolved', -3, 'Explained daily / monthly view on a call.'],
    ['DC isolator replacement', 'Steelcity', 'Breakdown', 'High', 'Open', -1, ''],
    ['Pre-monsoon cleaning', 'Navrang', 'Cleaning', 'Medium', 'Closed', -60, 'Cleaned 60 panels, checked clamps.'],
  ];
  TK.forEach(([subject, cn, type, priority, status, dueOff, resolution], i) => {
    const created = D(Math.min(dueOff, 0) - ri(1, 4));
    add('tickets', { subject, customerId: C(cn).id, type, priority, assignedTo: status === 'Open' ? undefined : techs[i % 2].id, status, dueDate: D(dueOff),
      description: `${subject}. Reported by customer on call.`, resolution }, stamp(created, 10), manager.id);
  });
  for (const t of data.tickets) { if (!t.assignedTo) delete t.assignedTo; if (!t.resolution) delete t.resolution; }
  number('tickets', 'TKT');

  // ---------- AMC contracts
  const AMCS = [['Hotel Pataliputra', -175, 4, 24000, 'Active'], ['Mithila Rice', -132, 4, 30000, 'Active'], ['Ramesh Prasad', -185, 2, 3500, 'Active'],
    ['Amit Kumar', -150, 2, 3000, 'Active'], ['Alok', -108, 4, 4500, 'Active'], ['Navrang', -345, 4, 28000, 'Active'], ['Steelcity', -380, 4, 22000, 'Renewed'], ['Kongu', -400, 2, 12000, 'Expired']];
  AMCS.forEach(([cn, startOff, visits, amount, status]) => {
    const start = D(startOff);
    const c = C(cn);
    if (status !== 'Expired') c.lifecycle = 'AMC';
    add('amcs', { customerId: c.id, startDate: start, endDate: addDays(start, 364), visitsPerYear: visits, amount, status,
      notes: visits === 4 ? 'Quarterly cleaning, inverter health check, earthing test.' : 'Half-yearly cleaning and health check.' }, stamp(start, 12), accounts.id);
  });
  number('amcs', 'AMC');

  // ---------- documents (tiny placeholder files)
  const fakePdf = (name) => ({ name, size: 912, type: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + Buffer.from(`%PDF-1.4\n% ${name} (demo placeholder)\n`).toString('base64') });
  const DOCS2 = [['Aadhaar — Ramesh Prasad Singh', 'KYC', 'Ramesh Prasad'], ['Net-metering agreement', 'Agreement', 'Ramesh Prasad'], ['Panel warranty certificate', 'Warranty', 'Hotel Pataliputra'],
    ['Commissioning report', 'Project', 'Mithila Rice'], ['PM Surya Ghar sanction letter', 'Subsidy', 'Amit Kumar'], ['Electricity bill — Sep', 'KYC', 'Anjali'],
    ['Inverter warranty card', 'Warranty', 'Alok'], ['Structure stability certificate', 'Project', 'Shree Balaji'], ['Signed quotation', 'Agreement', 'Arvind'], ['DISCOM feasibility approval', 'Project', 'Manoj Kumar']];
  DOCS2.forEach(([name, category, cn], i) => {
    const c = C(cn);
    const pr = projects.find((p) => p.customerId === c.id);
    add('documents', { name, category, customerId: c.id, projectId: pr?.id, file: fakePdf(name.replace(/[^A-Za-z0-9]+/g, '_') + '.pdf'), notes: '' }, stamp(D(-ri(2, 150)), 15), pick([admin, accounts, sales1]).id);
  });
  for (const d of data.documents) if (!d.projectId) delete d.projectId;

  // ---------- employees & attendance
  const EMP = [[admin.name, 'Director', 'Admin', 0], [manager.name, 'Project Manager', 'Projects', 42000], [sales1.name, 'Sales Executive', 'Sales', 26000], [sales2.name, 'Sales Executive', 'Sales', 24000],
    [tech1.name, 'Senior Technician', 'Installation', 28000], [tech2.name, 'Service Engineer', 'Service', 27000], [accounts.name, 'Accountant', 'Accounts', 30000],
    ['Deepak Kumar', 'Electrician', 'Installation', 18000], ['Ravi Paswan', 'Installation Helper', 'Installation', 13000], ['Manoj Thakur', 'Store Keeper', 'Purchase', 16000], ['Pooja Singh', 'Office Executive', 'Admin', 17000]];
  const emps = EMP.map(([name, designation, department, monthlySalary], i) => add('employees', {
    name, phone: phone(), email: `${name.split(' ')[0].toLowerCase()}@suryoday.example`, designation, department, joiningDate: D(-400 - i * 37),
    monthlySalary, active: true,
  }, stamp(D(-244), 10 + (i % 6)), admin.id));
  for (const e of emps) if (!e.monthlySalary) delete e.monthlySalary;
  for (let back = 13; back >= 0; back--) {
    const d = D(-back);
    if (weekday(d) === 0) continue;
    emps.forEach((e, i) => {
      if (i === 0) return;
      const roll = (back * 7 + i * 3) % 23;
      const status = roll === 0 ? 'Leave' : roll === 5 ? 'Half Day' : roll === 9 || roll === 14 ? 'Late' : roll === 19 ? 'Absent' : 'Present';
      const rec = { employeeId: e.id, date: d, status };
      if (['Present', 'Late', 'Half Day'].includes(status)) {
        rec.checkIn = status === 'Late' ? `10:${String(ri(10, 45)).padStart(2, '0')}` : `09:${String(ri(20, 58)).padStart(2, '0')}`;
        if (back > 0) rec.checkOut = status === 'Half Day' ? '14:00' : `18:${String(ri(0, 45)).padStart(2, '0')}`;
      }
      add('attendance', rec, stamp(d, 10), accounts.id);
    });
  }

  // ---------- expenses
  const months = [];
  for (let m = 7; m >= 0; m--) { const d = new Date(TODAY + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - m); months.push(d.toISOString().slice(0, 10)); }
  for (const m of months) {
    const first = m, sal = addDays(m, 6);
    if (first <= TODAY) add('expenses', { description: 'Office rent — Boring Road', category: 'Rent', amount: 35000, date: work(addDays(first, 1)) }, stamp(work(addDays(first, 1)), 11), accounts.id);
    if (sal <= TODAY) add('expenses', { description: 'Staff salaries', category: 'Salary', amount: 241000, date: work(sal) }, stamp(work(sal), 11), accounts.id);
    const util = addDays(m, 12);
    if (util <= TODAY) add('expenses', { description: 'Electricity & internet', category: 'Utilities', amount: ri(5200, 7800), date: work(util) }, stamp(work(util), 11), accounts.id);
    const mk = addDays(m, 15);
    if (mk <= TODAY) add('expenses', { description: pick(['Facebook & Instagram ads', 'Google ads — solar rooftop', 'Pamphlets & hoarding']), category: 'Marketing', amount: ri(8, 22) * 1000, date: work(mk) }, stamp(work(mk), 11), accounts.id);
  }
  for (const pr of projects) {
    if (STAGES.indexOf(pr.stage) < 3) continue;
    const d1 = work(addDays(pr.startDate, 9));
    if (d1 <= TODAY) add('expenses', { description: `Transport of material — ${pr.name.split(' — ')[0]}`, category: 'Transport', amount: Math.round((2500 + pr.capacityKw * 350) / 100) * 100, date: d1, projectId: pr.id }, stamp(d1, 17), accounts.id);
    const d2 = work(addDays(pr.startDate, 17));
    if (d2 <= TODAY) add('expenses', { description: `Labour (contract) — ${pr.name.split(' — ')[0]}`, category: 'Labour', amount: Math.round((3000 + pr.capacityKw * 900) / 100) * 100, date: d2, projectId: pr.id }, stamp(d2, 17), accounts.id);
  }
  add('expenses', { description: 'Safety harnesses & helmets', category: 'Material', amount: 18600, date: work(D(-64)) }, stamp(work(D(-64)), 12), accounts.id);
  add('expenses', { description: 'Printer cartridges & stationery', category: 'Office', amount: 4350, date: work(D(-17)) }, stamp(work(D(-17)), 12), accounts.id);
  add('expenses', { description: 'Solar expo registration', category: 'Other', amount: 15000, date: work(D(-26)) }, stamp(work(D(-26)), 12), accounts.id);
  number('expenses', 'EX');

  // ---------- tidy private helper fields
  for (const c of customers) { delete c._lat; delete c._lng; if (!c.gstin) delete c.gstin; }
  for (const pr of projects) for (const k of Object.keys(pr)) if (k.startsWith('_')) delete pr[k];
  for (const list of Object.values(data)) for (const r of list) for (const [k, v] of Object.entries(r)) if (v === undefined) delete r[k];

  // ---------- counters (highest sequence per key)
  const counters = {};
  for (const [entity, list] of Object.entries(data)) for (const r of list) {
    if (!r._numKey) continue;
    counters[r._numKey] = Math.max(counters[r._numKey] || 0, r._seq);
  }
  return { data, users, counters, picks: pickRecords(data, P) };
}

/** Records the screenshots point at. */
function pickRecords(data, P) {
  const byNum = (e, pred) => data[e].find(pred);
  const cust = (id) => data.customers.find((c) => c.id === id);
  const paid = (inv) => data.payments.filter((p) => p.invoiceId === inv.id).reduce((s, p) => s + p.amount, 0);
  const invUnpaid = data.invoices.filter((i) => paid(i) === 0 && cust(i.customerId).state === 'Bihar').sort((a, b) => b.date.localeCompare(a.date))[0]
    || data.invoices.filter((i) => paid(i) === 0).sort((a, b) => b.date.localeCompare(a.date))[0];
  const quote = data.quotations.find((q) => q.systemKw === 5 && q.status === 'Accepted' && cust(q.customerId).state === 'Bihar') || data.quotations[0];
  const statementCust = data.customers.find((c) => c.name.startsWith('Ramesh Prasad'));
  return {
    quote: quote.id,
    quoteEdit: (data.quotations.find((q) => q.status === 'Sent' && q.systemKw >= 12) || quote).id,
    invoice: invUnpaid.id,
    challan: (data.dispatches.find((d) => d.status === 'Delivered' && d.items.length >= 8) || data.dispatches[0]).id,
    certificate: (byNum('installations', (i) => i.status === 'Completed' && data.projects.find((p) => p.id === i.projectId)?.capacityKw >= 5) || data.installations[0]).id,
    po: (data.purchaseOrders.find((p) => p.status === 'Received' && p.items.length >= 3) || data.purchaseOrders[0]).id,
    loan: data.loans.find((l) => l.status === 'Repaying').id,
    statement: statementCust.id,
    project: data.projects.find((p) => p.stage === 'Handover').id,
  };
}

// ---------------------------------------------------------------- images made with the browser
async function renderPng(browser, html, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${html}</body></html>`);
  const buf = await page.locator('body > *').first().screenshot({ omitBackground: true });
  await page.close();
  return buf;
}
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <rect x="6" y="6" width="228" height="228" rx="44" fill="#ffffff"/>
  <rect x="6" y="6" width="228" height="228" rx="44" fill="none" stroke="#0f6b5c" stroke-width="8"/>
  <g transform="translate(120 104)">
    ${Array.from({ length: 12 }, (_, i) => `<rect x="-5" y="-78" width="10" height="24" rx="5" fill="#f2a900" transform="rotate(${i * 30})"/>`).join('')}
    <circle r="42" fill="#eb6834"/><circle r="30" fill="#f2a900"/>
  </g>
  <path d="M34 196 L206 196 L184 158 L56 158 Z" fill="#0f6b5c"/>
  <path d="M77 158 L70 196 M120 158 L120 196 M163 158 L170 196 M45 177 L195 177" stroke="#ffffff" stroke-width="4"/>
</svg>`;
const SIGN_HTML = `<div style="width:360px;height:110px;display:flex;align-items:center;justify-content:center;font-family:Z003,'URW Chancery L',cursive;font-size:54px;color:#1c3d8f;transform:rotate(-4deg)">Rohit Sinha</div>`;

// ---------------------------------------------------------------- screenshots
const HIDE_CSS = `.appbar{position:static!important} .toasts{display:none!important} ::-webkit-scrollbar{width:0!important;height:0!important;display:none!important} html,body{scrollbar-width:none!important} *{caret-color:transparent!important}`;

async function main() {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
  await new Promise((res, rej) => {
    server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); });
    server.stderr.on('data', (d) => process.stderr.write(d));
    server.on('exit', (c) => rej(new Error('vite preview exited ' + c + ' (is port ' + PORT + ' free? is dist/ built?)')));
    setTimeout(() => rej(new Error('vite preview did not start')), 20000);
  });
  const browser = await chromium.launch({ args: ['--lang=en-IN'], env: { ...process.env, LANG: 'en_IN.UTF-8', LANGUAGE: 'en_IN:en' } });
  try {
    if (ONLY !== 'pdf') await screenshots(browser);
    await renderPdf(browser);
  } finally {
    await browser.close();
    server.kill();
  }
}

async function screenshots(browser) {
  mkdirSync(IMG, { recursive: true });
  const logo = await renderPng(browser, LOGO_SVG, 240, 240);
  const sign = await renderPng(browser, SIGN_HTML, 360, 110);
  const ctxOpts = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'en-IN', timezoneId: 'Asia/Kolkata' };
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); });
  }, HIDE_CSS);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  console.log('• creating the admin through the UI');
  await page.goto(BASE);
  await page.getByLabel('Your name').fill('Rohit Sinha');
  await page.getByLabel('Email').fill('rohit@suryoday.example');
  await page.getByLabel('Mobile number').fill('9835012345');
  await page.getByLabel('Password', { exact: true }).fill('demo-password-123');
  await page.getByLabel('Confirm password').fill('demo-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Save your recovery code').waitFor();
  await page.getByLabel('I have saved this code').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: /Hello, Rohit/ }).waitFor();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ss1:users') || '[]'));
  const admin = stored[0];
  admin.logo = { name: 'suryoday-logo.png', size: logo.length, type: 'image/png', dataUrl: 'data:image/png;base64,' + logo.toString('base64') };
  admin.signature = { name: 'signature.png', size: sign.length, type: 'image/png', dataUrl: 'data:image/png;base64,' + sign.toString('base64') };
  const { data, users, counters, picks } = buildData(admin);
  const total = Object.values(data).reduce((s, l) => s + l.length, 0);
  console.log(`• injecting ${total} demo records into ${Object.keys(data).length} tables`);
  await page.evaluate(({ data, users, counters, adminUser }) => {
    const P = 'ss1:';
    for (const [k, list] of Object.entries(data)) localStorage.setItem(P + 'data:' + k, JSON.stringify(list));
    localStorage.setItem(P + 'entities', JSON.stringify(Object.keys(data)));
    localStorage.setItem(P + 'counters', JSON.stringify(counters));
    localStorage.setItem(P + 'users', JSON.stringify([adminUser, ...users]));
    localStorage.setItem(P + 'theme', 'light');
  }, { data, users, counters, adminUser: stored[0] });
  await page.reload();
  await page.getByRole('heading', { name: /Hello, Rohit/ }).waitFor();

  const setTemplate = async (tpl) => {
    await page.evaluate((tpl) => {
      const k = 'ss1:data:_settings';
      const list = JSON.parse(localStorage.getItem(k));
      list[0].printTemplate = tpl;
      localStorage.setItem(k, JSON.stringify(list));
    }, tpl);
    await page.goto(BASE + '#/');
    await page.reload();
    await page.getByRole('heading', { name: /Hello, Rohit/ }).waitFor();
  };
  const go = async (route, waitSel = 'h1') => {
    await page.goto(BASE + '#' + route);
    await page.locator(waitSel).first().waitFor({ timeout: 15000 });
    await page.mouse.move(1439, 899);
    await page.waitForTimeout(700);
  };
  const out = (name) => join(IMG, name + '.png');
  const shot = async (name, opts = {}) => { await page.screenshot({ path: out(name), ...opts }); console.log('  ✓ ' + name); };
  const el = async (name, sel) => { await page.locator(sel).first().screenshot({ path: out(name) }); console.log('  ✓ ' + name); };
  const want = (name) => !ONLY || ONLY.split(',').includes(name);

  console.log('• desktop screenshots');
  if (want('home')) { await go('/', '.app-grid'); await shot('home'); }
  if (want('dashboard')) {
    await go('/dashboard', '.india-map path.map-state');
    await page.locator('.chart-card').nth(3).waitFor();
    await page.waitForTimeout(800);
    await shot('dashboard');
    await shot('dashboard-full', { fullPage: true });
    await el('dashboard-map', '.map-layout');
    await el('dashboard-kpis', '.kpis');
    await el('dashboard-charts', '.grid.grid-2');
    await el('dashboard-cashflow', '.chart-card');
    await el('dashboard-mapcard', '.map-layout > .card');
    await el('chart-category', '.chart-card >> nth=1');
    await el('chart-pipeline', '.chart-card >> nth=2');
  }
  if (want('leads-board')) { await go('/m/leads?view=board', '.board .tile'); await shot('leads-board'); }
  if (want('leads-list')) { await go('/m/leads', 'tbody tr'); await shot('leads-list'); }
  if (want('customers-map')) { await go('/m/customers?view=map', '.india-map path.map-state'); await page.waitForTimeout(600); await shot('customers-map'); }
  if (want('quotations-pivot')) {
    await go('/m/quotations?view=pivot', 'table.pivot');
    try {
      await page.locator('#vs-rows').selectOption({ label: 'Date (month)' });
      await page.locator('#vs-columns').selectOption({ label: 'Status' });
    } catch { /* keep the default */ }
    await page.waitForTimeout(400);
    await shot('quotations-pivot');
  }
  if (want('quotations-graph')) {
    await go('/m/quotations?view=graph', '.card .chart, .card .bars, .card .donut-wrap');
    await shot('quotations-graph');
  }
  if (want('invoices-graph')) {
    await go('/m/invoices?view=graph', '.card .chart, .card .bars, .card .donut-wrap');
    try {
      await page.locator('#vs-group-by').selectOption({ label: 'Invoice date (month)' });
      await page.locator('#vs-split-by').selectOption({ label: 'Payment' });
    } catch { /* keep defaults */ }
    await page.waitForTimeout(400);
    await shot('invoices-graph');
  }
  if (want('tasks-calendar')) { await go('/m/tasks?view=calendar', '.cal'); await shot('tasks-calendar'); }
  if (want('quotation-form')) {
    await go(`/m/quotations/${picks.quoteEdit}/edit`, '.items-table');
    await page.evaluate(() => { const t = document.querySelector('h1'); window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 24); });
    await page.waitForTimeout(300);
    await shot('quotation-form');
  }
  if (want('products-list')) { await go('/m/products', 'tbody tr'); await shot('products-list'); }
  if (want('stock-moves')) { await go('/m/stockMoves', 'tbody tr'); await shot('stock-moves'); }
  if (want('challans-list')) { await go('/m/dispatches', 'tbody tr'); await shot('challans-list'); }
  if (want('projects-board')) { await go('/m/projects?view=board', '.board .tile'); await shot('projects-board'); }
  if (want('project-detail')) { await go(`/m/projects/${picks.project}`, 'h1'); await shot('project-detail'); }
  if (want('installations-list')) { await go('/m/installations', 'tbody tr'); await shot('installations-list'); }
  if (want('installations-map')) { await go('/m/installations?view=map', '.india-map path.map-state'); await shot('installations-map'); }
  if (want('po-list')) { await go('/m/purchaseOrders', 'tbody tr'); await shot('po-list'); }
  if (want('vendors-list')) { await go('/m/vendors', 'tbody tr'); await shot('vendors-list'); }
  if (want('invoices-list')) { await go('/m/invoices', 'tbody tr'); await shot('invoices-list'); }
  if (want('payments-list')) { await go('/m/payments', 'tbody tr'); await shot('payments-list'); }
  if (want('subsidy-board')) { await go('/m/subsidies?view=board', '.board .tile'); await shot('subsidy-board'); }
  if (want('loans-list')) { await go('/m/loans', 'tbody tr'); await shot('loans-list'); }
  if (want('tickets-board')) { await go('/m/tickets?view=board', '.board .tile'); await shot('tickets-board'); }
  if (want('amc-list')) { await go('/m/amcs', 'tbody tr'); await shot('amc-list'); }
  if (want('documents-list')) { await go('/m/documents', 'tbody tr'); await shot('documents-list'); }
  if (want('attendance-pivot')) {
    await go('/m/attendance?view=pivot', 'table.pivot');
    try {
      await page.locator('#vs-rows').selectOption({ label: 'Employee' });
      await page.locator('#vs-columns').selectOption({ label: 'Status' });
    } catch { /* defaults */ }
    await page.waitForTimeout(300);
    await shot('attendance-pivot');
  }
  if (want('employees-list')) { await go('/m/employees', 'tbody tr'); await shot('employees-list'); }
  if (want('alerts')) { await go('/alerts', 'h1'); await shot('alerts'); }
  if (want('reports')) {
    await go('/reports', '.chart-card');
    await shot('reports');
    await shot('reports-full', { fullPage: true });
  }
  if (want('settings')) {
    await go('/settings', 'h2');
    await el('settings-print', '.card:has(h2:text-is("Print templates"))');
    await el('settings-users', '.card:has(h2:text-is("Users & roles"))');
    await el('settings-company', '.card:has(h2:text-is("Company profile"))');
  }

  console.log('• printed documents');
  const doc = async (name, route) => { await go(route, '.doc .doc-title'); await page.waitForTimeout(400); await el(name, '.doc'); };
  await setTemplate('modern');
  if (want('print-quotation')) await doc('print-quotation', `/print/quotations/${picks.quote}`);
  if (want('print-invoice')) await doc('print-invoice', `/print/invoices/${picks.invoice}`);
  if (want('print-statement')) await doc('print-statement', `/print/customers/${picks.statement}`);
  if (want('print-project')) await doc('print-project', `/print/projects/${picks.project}`);
  await setTemplate('classic');
  if (want('print-challan')) await doc('print-challan', `/print/dispatches/${picks.challan}`);
  if (want('print-po')) await doc('print-po', `/print/purchaseOrders/${picks.po}`);
  if (want('print-invoice-classic')) await doc('print-invoice-classic', `/print/invoices/${picks.invoice}`);
  await setTemplate('compact');
  if (want('print-certificate')) await doc('print-certificate', `/print/installations/${picks.certificate}`);
  if (want('print-loan')) await doc('print-loan', `/print/loans/${picks.loan}`);
  await setTemplate('modern');

  // ---------- phone
  console.log('• phone screenshots');
  const state = await ctx.storageState();
  const pctx = await browser.newContext({ ...ctxOpts, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: state });
  await pctx.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); });
  }, HIDE_CSS);
  const ph = await pctx.newPage();
  const pgo = async (route, sel = 'h1') => { await ph.goto(BASE + '#' + route); await ph.locator(sel).first().waitFor({ timeout: 15000 }); await ph.waitForTimeout(700); };
  if (want('phone-home')) { await pgo('/', '.app-grid'); await ph.screenshot({ path: out('phone-home') }); console.log('  ✓ phone-home'); }
  if (want('phone-dashboard')) { await pgo('/dashboard', '.india-map path.map-state'); await ph.waitForTimeout(600); await ph.screenshot({ path: out('phone-dashboard') }); console.log('  ✓ phone-dashboard');
    await ph.evaluate(() => { const m = document.querySelector('.map-layout'); window.scrollTo(0, m.getBoundingClientRect().top + window.scrollY - 70); });
    await ph.waitForTimeout(300); await ph.screenshot({ path: out('phone-map') }); console.log('  ✓ phone-map'); }
  if (want('phone-lead-form')) {
    await pgo('/m/leads/new', '#f-name');
    await ph.locator('#f-name').fill('Kavita Sinha');
    await ph.locator('#f-phone').fill('98350 44120');
    await ph.locator('#f-city').fill('Patna');
    await ph.locator('#f-pincode').fill('800020');
    try { await ph.locator('#f-source').selectOption('WhatsApp'); } catch { /* optional */ }
    await ph.locator('#f-capacityKw').fill('5');
    await ph.locator('#f-monthlyBill').fill('3200');
    await ph.evaluate(() => window.scrollTo(0, 0));
    await ph.mouse.click(1, 1).catch(() => {});
    await ph.waitForTimeout(300);
    await ph.screenshot({ path: out('phone-lead-form') }); console.log('  ✓ phone-lead-form');
  }
  if (want('phone-invoice')) { await pgo(`/print/invoices/${picks.invoice}`, '.doc .doc-title'); await ph.screenshot({ path: out('phone-invoice') }); console.log('  ✓ phone-invoice'); }
  if (want('phone-leads')) { await pgo('/m/leads?view=board', '.board .tile'); await ph.screenshot({ path: out('phone-leads') }); console.log('  ✓ phone-leads'); }
  await pctx.close();
  // Home screen at a larger zoom so the app tiles fill the laptop screen in the brochure.
  if (want('home')) {
    const hctx = await browser.newContext({ ...ctxOpts, viewport: { width: 1152, height: 720 }, deviceScaleFactor: 2.5, storageState: state });
    await hctx.addInitScript((css) => {
      document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); });
    }, HIDE_CSS);
    const hp = await hctx.newPage();
    await hp.goto(BASE + '#/'); await hp.locator('.app-grid').waitFor(); await hp.mouse.move(1150, 718); await hp.waitForTimeout(600);
    await hp.screenshot({ path: out('home') }); console.log('  ✓ home (zoomed)');
    await hctx.close();
  }
  await ctx.close();
  const noisy = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
  if (noisy.length) console.log('! browser errors while taking screenshots:\n  ' + noisy.join('\n  '));
}

async function renderPdf(browser) {
  if (!existsSync(HTML)) { console.log('! ' + HTML + ' not found — skipping the PDF'); return; }
  console.log('• rendering the brochure PDF');
  const page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
  await page.evaluate((b) => {
    document.querySelectorAll('[data-brand]').forEach((e) => { e.textContent = b.name; });
    document.querySelectorAll('[data-brand-tagline]').forEach((e) => { e.textContent = b.tagline; });
    document.title = `${b.name} — Product brochure`;
  }, BRAND);
  await page.evaluate(() => Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })))));
  const missing = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
  if (missing.length) console.log('! missing images: ' + missing.join(', '));
  await page.pdf({ path: PDF, format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });
  await page.close();
  console.log(`✓ ${PDF} (${(statSync(PDF).size / 1048576).toFixed(1)} MB)`);
}

// The same dataset is also the in-app demo data (scripts/make-demo-data.mjs imports it).
export { buildData, TODAY };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist/ is missing — run `npm run build` first.'); process.exit(1); }
  await main();
}
