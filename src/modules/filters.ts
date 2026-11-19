import { tracksStock } from '../lib/store/stock';
// Ready-made filters for each list: filters in the same section are combined with OR,
// sections with AND ("Stage: New or Contacted" AND "Residential"). Written for a solar business.
import type { Entity, Rec } from '../lib/schema';
import type { Store } from '../lib/store';
import { addDaysIso, localDateOf } from '../lib/format';
import { canonicalState, stateFromGstin } from '../lib/states';

export interface FilterCtx { store: Store; me: string; today: string; companyState: string }
export interface FilterDef { key: string; label: string; section: string; test: (r: Rec, c: FilterCtx) => boolean }

type Def = Omit<FilterDef, 'section'>;

/** "2026-11-05", "2026-11-05T10:30" or a full ISO time → the local calendar day, or '' */
export function dayOf(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  return v.length > 16 ? localDateOf(v) : v.slice(0, 10);
}

const num = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const inRange = (d: string, from: string, to: string) => !!d && d >= from && d <= to;

/** Calendar periods, India's financial year (April–March) included. */
export function period(kind: 'month' | 'lastMonth' | 'quarter' | 'fy' | 'lastFy', today: string): [string, string] {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const ymd = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (kind === 'month') return [ymd(y, m, 1), ymd(y, m, lastDay(y, m))];
  if (kind === 'lastMonth') { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return [ymd(yy, mm, 1), ymd(yy, mm, lastDay(yy, mm))]; }
  if (kind === 'quarter') { const q0 = Math.floor((m - 1) / 3) * 3 + 1; return [ymd(y, q0, 1), ymd(y, q0 + 2, lastDay(y, q0 + 2))]; }
  const fy = m >= 4 ? y : y - 1;
  const start = kind === 'fy' ? fy : fy - 1;
  return [ymd(start, 4, 1), ymd(start + 1, 3, 31)];
}

const section = (name: string, defs: Def[]): FilterDef[] => defs.map((d) => ({ ...d, section: name }));

function options(e: Entity, fieldKey: string, name?: string): FilterDef[] {
  const f = e.fields.find((x) => x.key === fieldKey);
  if (!f?.options) return [];
  return section(name || f.label, f.options.map((o) => ({ key: `${fieldKey}:${o}`, label: o, test: (r) => r[fieldKey] === o })));
}

function sizes(key: string, name = 'System size'): FilterDef[] {
  return section(name, [
    { key: `${key}:upto3`, label: 'Up to 3 kW (PM Surya Ghar)', test: (r) => num(r[key]) > 0 && num(r[key]) <= 3 },
    { key: `${key}:3to10`, label: '3 – 10 kW', test: (r) => num(r[key]) > 3 && num(r[key]) <= 10 },
    { key: `${key}:over10`, label: 'Above 10 kW (commercial)', test: (r) => num(r[key]) > 10 },
  ]);
}

const segments: Def[] = [
  { key: 'seg:res', label: 'Residential rooftop', test: (r) => r.segment === 'Residential' },
  { key: 'seg:ci', label: 'Commercial & industrial', test: (r) => r.segment === 'Commercial' || r.segment === 'Industrial' },
  { key: 'seg:agri', label: 'Agriculture (solar pumps)', test: (r) => r.segment === 'Agriculture' },
  { key: 'seg:gov', label: 'Government', test: (r) => r.segment === 'Government' },
];

const OPEN_LEAD = (r: Rec) => !['Won', 'Lost'].includes(String(r.status));
const OPEN_TICKET = (r: Rec) => !['Resolved', 'Closed'].includes(String(r.status));

/** Filters written for each kind of record. */
const CURATED: Record<string, (e: Entity) => FilterDef[]> = {
  leads: () => [
    ...section('Pipeline', [
      { key: 'open', label: 'Open leads', test: OPEN_LEAD },
      { key: 'hot', label: 'Proposal or negotiation', test: (r) => r.status === 'Proposal Sent' || r.status === 'Negotiation' },
    ]),
    ...section('Follow-up', [
      { key: 'fu:overdue', label: 'Follow-up overdue', test: (r, c) => OPEN_LEAD(r) && !!dayOf(r.nextFollowUp) && dayOf(r.nextFollowUp) < c.today },
      { key: 'fu:today', label: 'Follow-up today', test: (r, c) => dayOf(r.nextFollowUp) === c.today },
      { key: 'fu:week', label: 'Follow-up in the next 7 days', test: (r, c) => inRange(dayOf(r.nextFollowUp), c.today, addDaysIso(c.today, 7)) },
      { key: 'fu:none', label: 'No follow-up planned', test: (r) => OPEN_LEAD(r) && !r.nextFollowUp },
    ]),
    ...section('Customer type', segments),
    ...sizes('capacityKw', 'Required size'),
    ...section('Electricity bill', [
      { key: 'bill:high', label: 'Bill ₹3,000+ a month (strong case)', test: (r) => num(r.monthlyBill) >= 3000 },
      { key: 'bill:low', label: 'Bill under ₹1,500 a month', test: (r) => num(r.monthlyBill) > 0 && num(r.monthlyBill) < 1500 },
    ]),
    ...section('Lead source', [
      { key: 'src:online', label: 'Online (website, social, Google, WhatsApp)', test: (r) => ['Website', 'Facebook', 'Instagram', 'Google', 'WhatsApp'].includes(String(r.source)) },
      { key: 'src:ref', label: 'Referral, walk-in or exhibition', test: (r) => ['Referral', 'Walk-in', 'Exhibition'].includes(String(r.source)) },
      { key: 'src:call', label: 'Phone call', test: (r) => r.source === 'Call' },
    ]),
  ],
  customers: (e) => [
    ...section('Customer type', segments),
    ...options(e, 'lifecycle'),
    ...section('GST', [
      { key: 'b2b', label: 'Business (has GSTIN)', test: (r) => !!r.gstin },
      { key: 'b2c', label: 'Individual (no GSTIN)', test: (r) => !r.gstin },
    ]),
    ...section('Location', [
      { key: 'loc:home', label: 'In our state (CGST + SGST)', test: (r, c) => !!c.companyState && stateOf(r) === c.companyState },
      { key: 'loc:other', label: 'Other states (IGST)', test: (r, c) => !!c.companyState && !!stateOf(r) && stateOf(r) !== c.companyState },
    ]),
    ...section('Missing details', [
      { key: 'miss:pin', label: 'No PIN code', test: (r) => !r.pincode },
      { key: 'miss:consumer', label: 'No electricity consumer no.', test: (r) => !r.consumerNo },
    ]),
  ],
  activities: (e) => [
    ...options(e, 'type'),
    ...section('When', [
      { key: 'when:next', label: 'Coming up', test: (r, c) => dayOf(r.when) >= c.today },
      { key: 'when:past', label: 'Done / past', test: (r, c) => !!dayOf(r.when) && dayOf(r.when) < c.today },
    ]),
  ],
  surveys: () => [
    ...section('Roof', [
      { key: 'roof:rcc', label: 'RCC (concrete) roof', test: (r) => r.roofType === 'RCC' },
      { key: 'roof:sheet', label: 'Tin or asbestos sheet', test: (r) => r.roofType === 'Tin Shed' || r.roofType === 'Asbestos' },
      { key: 'roof:ground', label: 'Ground mount', test: (r) => r.roofType === 'Ground Mount' },
    ]),
    ...section('Shading', [
      { key: 'shade:none', label: 'Shade-free', test: (r) => r.shading === 'None' },
      { key: 'shade:some', label: 'Partial or heavy shade', test: (r) => r.shading === 'Partial' || r.shading === 'Heavy' },
    ]),
    ...sizes('recommendedKw', 'Recommended size'),
  ],
  quotations: () => [
    ...section('Validity', [
      { key: 'val:live', label: 'Still valid', test: (r, c) => ['Draft', 'Sent'].includes(String(r.status)) && (!r.validTill || String(r.validTill) >= c.today) },
      { key: 'val:soon', label: 'Expiring in 7 days', test: (r, c) => ['Draft', 'Sent'].includes(String(r.status)) && inRange(String(r.validTill || ''), c.today, addDaysIso(c.today, 7)) },
      { key: 'val:past', label: 'Past valid date, no answer', test: (r, c) => ['Draft', 'Sent'].includes(String(r.status)) && !!r.validTill && String(r.validTill) < c.today },
    ]),
    ...section('Invoicing', [
      { key: 'inv:done', label: 'Converted to invoice', test: (r) => !!r.invoiceId },
      { key: 'inv:todo', label: 'Accepted, not invoiced yet', test: (r) => r.status === 'Accepted' && !r.invoiceId },
    ]),
    ...sizes('systemKw'),
    ...section('Value', [
      { key: 'v:1l', label: '₹1 lakh or more', test: (r, c) => (c.store.computed('quotations', r).grandTotal || 0) >= 100000 },
      { key: 'v:5l', label: '₹5 lakh or more', test: (r, c) => (c.store.computed('quotations', r).grandTotal || 0) >= 500000 },
    ]),
  ],
  projects: () => [
    ...section('Progress', [
      { key: 'p:start', label: 'Not started (planning, design)', test: (r) => r.stage === 'Planning' || r.stage === 'Design' },
      { key: 'p:work', label: 'Material, installation or testing', test: (r) => ['Material Procurement', 'Installation', 'Testing'].includes(String(r.stage)) },
      { key: 'p:net', label: 'Waiting for net meter', test: (r) => r.stage === 'Net Metering' },
      { key: 'p:done', label: 'Handed over', test: (r) => r.stage === 'Handover' },
    ]),
    ...section('Schedule', [
      { key: 'late', label: 'Delayed (past target date)', test: (r, c) => !!r.dueDate && String(r.dueDate) < c.today && !['Handover', 'On Hold'].includes(String(r.stage)) },
      { key: 'due:month', label: 'Target date this month', test: (r, c) => inRange(String(r.dueDate || ''), ...period('month', c.today)) },
    ]),
    ...section('Cost', [
      { key: 'over', label: 'Over budget', test: (r) => num(r.budget) > 0 && num(r.actualCost) > num(r.budget) },
    ]),
    ...sizes('capacityKw'),
  ],
  tasks: (e) => [
    ...section('Open', [{ key: 'open', label: 'Not done', test: (r) => r.status !== 'Done' }]),
    ...options(e, 'priority'),
    ...section('Schedule', [
      { key: 'late', label: 'Overdue', test: (r, c) => r.status !== 'Done' && !!r.dueDate && String(r.dueDate) < c.today },
      { key: 'week', label: 'Due in the next 7 days', test: (r, c) => r.status !== 'Done' && inRange(String(r.dueDate || ''), c.today, addDaysIso(c.today, 7)) },
    ]),
  ],
  installations: (e) => [
    ...options(e, 'status'),
    ...section('Schedule', [
      { key: 'today', label: 'Today', test: (r, c) => r.scheduledDate === c.today },
      { key: 'week', label: 'Next 7 days', test: (r, c) => inRange(String(r.scheduledDate || ''), c.today, addDaysIso(c.today, 7)) },
      { key: 'late', label: 'Overdue', test: (r, c) => ['Scheduled', 'In Progress', 'Delayed'].includes(String(r.status)) && !!r.scheduledDate && String(r.scheduledDate) < c.today },
    ]),
    ...section('Handover', [
      { key: 'conf:yes', label: 'Customer confirmed', test: (r) => !!r.customerConfirmed },
      { key: 'conf:no', label: 'Completed, not confirmed by customer', test: (r) => r.status === 'Completed' && !r.customerConfirmed },
    ]),
  ],
  products: (e) => [
    ...options(e, 'category'),
    ...section('Stock', [
      { key: 'st:out', label: 'Out of stock', test: (r, c) => tracksStock(r) && (c.store.computed('products', r).stock || 0) <= 0 },
      { key: 'st:low', label: 'Low stock (at or below alert level)', test: (r, c) => { const s = c.store.computed('products', r).stock || 0; return tracksStock(r) && s > 0 && s <= num(r.reorderLevel); } },
      { key: 'st:ok', label: 'In stock', test: (r, c) => tracksStock(r) && (c.store.computed('products', r).stock || 0) > 0 },
      { key: 'st:order', label: 'On order', test: (r, c) => c.store.onOrder(r.id) > 0 },
      { key: 'st:service', label: 'Services (no stock kept)', test: (r) => !tracksStock(r) },
    ]),
    ...section('GST rate', [
      { key: 'gst:5', label: '5% (solar panels, inverters)', test: (r) => String(r.gstRate) === '5' },
      { key: 'gst:18', label: '18%', test: (r) => String(r.gstRate) === '18' },
      { key: 'gst:other', label: 'Other rates', test: (r) => !['5', '18'].includes(String(r.gstRate)) },
    ]),
  ],
  stockMoves: (e) => [
    ...options(e, 'direction', 'Type'),
    ...section('Linked', [{ key: 'proj', label: 'Sent to a project', test: (r) => !!r.projectId }]),
  ],
  vendors: () => [
    ...section('Rating', [{ key: 'top', label: 'Rated 4 or 5', test: (r) => num(r.rating) >= 4 }]),
    ...section('Contract', [
      { key: 'c:soon', label: 'Contract ends in 60 days', test: (r, c) => inRange(String(r.contractEnd || ''), c.today, addDaysIso(c.today, 60)) },
      { key: 'c:over', label: 'Contract ended', test: (r, c) => !!r.contractEnd && String(r.contractEnd) < c.today },
    ]),
  ],
  purchaseOrders: () => [
    ...section('Receiving', [
      { key: 'rcv:todo', label: 'To receive', test: (r) => r.status === 'Ordered' || r.status === 'Partially Received' },
      { key: 'rcv:late', label: 'Late delivery', test: (r, c) => ['Ordered', 'Partially Received'].includes(String(r.status)) && !!r.expectedDate && String(r.expectedDate) < c.today },
    ]),
    ...section('Payment to vendor', [
      { key: 'pay:due', label: 'Not fully paid', test: (r, c) => r.status !== 'Cancelled' && (c.store.computed('purchaseOrders', r).due || 0) > 0.005 },
      { key: 'pay:done', label: 'Paid', test: (r, c) => (c.store.computed('purchaseOrders', r).grandTotal || 0) > 0 && (c.store.computed('purchaseOrders', r).due || 0) <= 0.005 },
    ]),
  ],
  invoices: () => [
    ...section('Invoice', [
      { key: 'issued', label: 'Issued (not draft or cancelled)', test: (r) => r.status !== 'Draft' && r.status !== 'Cancelled' },
    ]),
    ...section('Payment', [
      { key: 'pay:unpaid', label: 'Unpaid', test: (r, c) => c.store.paymentStatus(r) === 'Unpaid' },
      { key: 'pay:part', label: 'Partially paid', test: (r, c) => c.store.paymentStatus(r) === 'Partially Paid' },
      { key: 'pay:paid', label: 'Paid', test: (r, c) => c.store.paymentStatus(r) === 'Paid' },
    ]),
    ...section('Due', [
      { key: 'due:over', label: 'Overdue', test: (r, c) => r.status !== 'Cancelled' && r.status !== 'Draft' && !!r.dueDate && String(r.dueDate) < c.today && (c.store.computed('invoices', r).balance || 0) > 0 },
      { key: 'due:week', label: 'Due in the next 7 days', test: (r, c) => r.status !== 'Cancelled' && r.status !== 'Draft' && inRange(String(r.dueDate || ''), c.today, addDaysIso(c.today, 7)) && (c.store.computed('invoices', r).balance || 0) > 0 },
    ]),
    ...section('GST', [
      { key: 'b2b', label: 'B2B (customer has GSTIN)', test: (r, c) => !!c.store.get('customers', r.customerId)?.gstin },
      { key: 'b2c', label: 'B2C', test: (r, c) => !c.store.get('customers', r.customerId)?.gstin },
      // The tax type saved on the invoice when it was made (what its totals show), else as it would be now.
      { key: 'igst', label: 'Inter-state (IGST)', test: (r, c) => (typeof r.interState === 'boolean' ? r.interState : c.store.interStateFor(r)) },
      { key: 'cgst', label: 'Within the state (CGST + SGST)', test: (r, c) => !(typeof r.interState === 'boolean' ? r.interState : c.store.interStateFor(r)) },
    ]),
  ],
  payments: (e) => [...options(e, 'mode'), ...options(e, 'kind', 'Kind')],
  expenses: (e) => [
    ...options(e, 'category'),
    ...section('Project', [{ key: 'proj', label: 'Charged to a project', test: (r) => !!r.projectId }]),
  ],
  subsidies: () => [
    ...section('Waiting', [
      { key: 'slow', label: 'Pending more than 30 days', test: (r, c) => !['Disbursed', 'Rejected'].includes(String(r.status)) && !!r.appliedOn && String(r.appliedOn) < addDaysIso(c.today, -30) },
    ]),
  ],
  loans: () => [
    ...section('Stage', [
      { key: 'l:pending', label: 'Waiting for the bank', test: (r) => ['Submitted', 'Verification'].includes(String(r.status)) },
      { key: 'l:ready', label: 'Approved or disbursed', test: (r) => ['Approved', 'Disbursed', 'Repaying'].includes(String(r.status)) },
    ]),
  ],
  tickets: (e) => [
    ...section('Open', [{ key: 'open', label: 'Open tickets', test: OPEN_TICKET }]),
    ...section('Priority', [{ key: 'urgent', label: 'Urgent or high', test: (r) => r.priority === 'Urgent' || r.priority === 'High' }]),
    ...section('Schedule', [{ key: 'late', label: 'Overdue', test: (r, c) => OPEN_TICKET(r) && !!r.dueDate && String(r.dueDate) < c.today }]),
    ...options(e, 'type'),
  ],
  amcs: () => [
    ...section('Renewal', [
      { key: 'ren:soon', label: 'Ends in the next 30 days', test: (r, c) => r.status === 'Active' && inRange(String(r.endDate || ''), c.today, addDaysIso(c.today, 30)) },
      { key: 'ren:over', label: 'Ended, not renewed', test: (r, c) => r.status === 'Active' && !!r.endDate && String(r.endDate) < c.today },
    ]),
  ],
  documents: (e) => options(e, 'category'),
  employees: (e) => [
    ...section('Status', [
      { key: 'active', label: 'Active', test: (r) => r.active !== false },
      { key: 'left', label: 'Left / inactive', test: (r) => r.active === false },
    ]),
    ...options(e, 'department'),
  ],
  attendance: (e) => [
    ...options(e, 'status'),
    ...section('Day', [{ key: 'today', label: 'Today', test: (r, c) => r.date === c.today }]),
  ],
};

function stateOf(r: Rec): string | undefined {
  return canonicalState(r.state) || stateFromGstin(r.gstin);
}

const MINE_LABEL: Record<string, string> = {
  assignedTo: 'Assigned to me', manager: 'Projects I manage', surveyor: 'My surveys', technician: 'My installations', assignee: 'My tasks',
};

/** The main date of a record type, for "This month / This financial year" filters. */
function mainDate(e: Entity) {
  const dates = e.fields.filter((f) => !f.hidden && (f.type === 'date' || f.type === 'datetime'));
  const prefer = ['date', 'surveyDate', 'scheduledDate', 'appliedOn', 'startDate', 'joiningDate', 'when', 'firstEmiDate'];
  return dates.find((f) => prefer.includes(f.key)) || (e.key === 'leads' ? undefined : dates[0]);
}

const cache = new Map<string, FilterDef[]>();

/** Every filter offered for a record type: the status, the people, the solar-specific ones and a period. */
export function filtersFor(e: Entity): FilterDef[] {
  const hit = cache.get(e.key);
  if (hit) return hit;
  const out: FilterDef[] = [];
  // People: "assigned to me" and friends, plus "created by me".
  const people = e.fields.filter((f) => f.type === 'user' && !f.hidden);
  out.push(...section('Mine', [
    ...people.map((f) => ({ key: `me:${f.key}`, label: MINE_LABEL[f.key] || `${f.label}: me`, test: (r: Rec, c: FilterCtx) => r[f.key] === c.me })),
    ...(people.some((f) => f.key === 'assignedTo') ? [{ key: 'unassigned', label: 'Not assigned to anyone', test: (r: Rec) => !r.assignedTo }] : []),
    { key: 'me:created', label: 'Created by me', test: (r: Rec, c: FilterCtx) => r.createdBy === c.me },
  ]));
  if (e.statusField) {
    const f = e.fields.find((x) => x.key === e.statusField)!;
    out.push(...section(f.label, (f.options || []).map((o) => ({ key: `st:${o}`, label: o, test: (r: Rec) => r[f.key] === o }))));
  }
  out.push(...(CURATED[e.key]?.(e) || []));
  const d = mainDate(e);
  if (!d) {
    const on = (r: Rec) => dayOf(r.createdAt);
    out.push(...section('Created', [
      { key: 'c:month', label: 'This month', test: (r, c) => inRange(on(r), ...period('month', c.today)) },
      { key: 'c:last', label: 'Last month', test: (r, c) => inRange(on(r), ...period('lastMonth', c.today)) },
      { key: 'c:fy', label: 'This financial year', test: (r, c) => inRange(on(r), ...period('fy', c.today)) },
    ]));
  }
  if (d) {
    const on = (r: Rec) => dayOf(r[d.key]);
    out.push(...section(d.label, [
      { key: 'd:month', label: 'This month', test: (r, c) => inRange(on(r), ...period('month', c.today)) },
      { key: 'd:last', label: 'Last month', test: (r, c) => inRange(on(r), ...period('lastMonth', c.today)) },
      { key: 'd:quarter', label: 'This quarter', test: (r, c) => inRange(on(r), ...period('quarter', c.today)) },
      { key: 'd:fy', label: 'This financial year', test: (r, c) => inRange(on(r), ...period('fy', c.today)) },
      { key: 'd:lastfy', label: 'Last financial year', test: (r, c) => inRange(on(r), ...period('lastFy', c.today)) },
    ]));
  }
  cache.set(e.key, out);
  return out;
}

/** Keeps the records that pass: OR inside a section, AND between sections. Unknown keys are ignored. */
export function applyFilters(e: Entity, rows: Rec[], keys: string[], ctx: FilterCtx): Rec[] {
  const defs = filtersFor(e).filter((f) => keys.includes(f.key));
  if (!defs.length) return rows;
  const bySection = new Map<string, FilterDef[]>();
  for (const d of defs) bySection.set(d.section, [...(bySection.get(d.section) || []), d]);
  const groups = [...bySection.values()];
  return rows.filter((r) => groups.every((g) => g.some((d) => d.test(r, ctx))));
}
