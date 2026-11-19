import { migrate } from './safety';
import { qtyByProduct, receivedOf, remainingOf, tracksStock, unitCostByProduct, valuation } from './stock';
import type { Entity, LineItem, Rec } from '../schema';
import { ENTITIES, getEntity } from '../../modules/registry';
import { coerce, normalizePhone, validateRecord } from '../validate';
import { computeEmi, computeTotals, financialYear, round2 } from '../money';
import { addDaysIso, formatDate, todayIso, uid } from '../format';
import { canonicalState, stateFromGstin } from '../states';
import { isPmSuryaGhar, pmSuryaGharSubsidy } from '../subsidy';
import { taxFor } from '../productTax';
import { waNumber } from '../whatsapp';
import { canDelete, canRead, canWrite, isAdmin, isOwnRecord, levelOf } from '../rbac';
import { AppError, ConflictError, type AppUser, type Backend, type DataMap, type FileRef, type Numbering, type RemoteChange, type ReplaceOptions } from './types';
import { ENDED_MESSAGE, type BusinessInfo } from '../subscription';

export const SETTINGS = '_settings';
/** History entries (activity log) for any record: created, changed fields, notes. */
export const ACTIVITY = 'activity';
export type ActivityKind = 'created' | 'changed' | 'note';
export interface ActivityChange { field: string; label: string; from: string; to: string }

export interface CompanySettings {
  companyName: string;
  gstin: string;
  pan: string;
  state: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  bankName: string;
  accountNo: string;
  ifsc: string;
  quoteTerms: string;
  invoiceTerms: string;
  paymentTermsDays: number;
  autoAssignLeads: boolean;
  autoCreateCustomer: boolean;
  /** quotations: valid-till date = quotation date + this many days */
  quoteValidDays: number;
  /** site surveys: who does them unless someone else is chosen */
  defaultSurveyor: string;
  /** where purchase orders are received when the order names no warehouse */
  defaultWarehouse: string;
  /** what the QR code on camera photos opens (empty: the photo's spot on a map) */
  photoQrUrl: string;
  /** note printed on camera photos unless one is typed */
  photoNote: string;
  /** the business's WhatsApp number (shown on quotations and invoices), if it has one */
  whatsapp: string;
  /** the business's own wording of WhatsApp messages, by template key (empty: the default) */
  waTemplates: Record<string, string>;
  // ----- print templates -----
  logo: FileRef | null;
  signature: FileRef | null;
  accentColor: string;
  printTemplate: 'classic' | 'modern' | 'compact';
  tagline: string;
  upiId: string;
  showUpiQr: boolean;
  showBankOnQuote: boolean;
  poTerms: string;
  challanTerms: string;
  declaration: string;
  footerNote: string;
  // ----- solar estimates on quotations -----
  showSavingsOnQuote: boolean;
  unitsPerKwPerDay: number;
  tariffPerUnit: number;
}

export const DEFAULT_SETTINGS: CompanySettings = {
  companyName: '', gstin: '', pan: '', state: '', address: '', phone: '', email: '', website: '',
  bankName: '', accountNo: '', ifsc: '',
  quoteTerms: '50% advance, 40% on material delivery, 10% after commissioning.\nQuote valid for 15 days.',
  invoiceTerms: 'Payment due within 15 days. Goods once sold will not be taken back.',
  paymentTermsDays: 15,
  autoAssignLeads: true,
  autoCreateCustomer: true,
  quoteValidDays: 15,
  defaultSurveyor: '',
  defaultWarehouse: '',
  photoQrUrl: '',
  photoNote: '',
  whatsapp: '',
  waTemplates: {},
  logo: null,
  signature: null,
  accentColor: '#0f6b5c',
  printTemplate: 'classic',
  tagline: '',
  upiId: '',
  showUpiQr: true,
  showBankOnQuote: false,
  poTerms: 'Deliver to the address above with the invoice and test certificates. Payment within 30 days of receipt.',
  challanTerms: 'Goods sent for installation at the site below. Not for sale.',
  declaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  footerNote: 'This is a computer-generated document.',
  showSavingsOnQuote: true,
  unitsPerKwPerDay: 4,
  tariffPerUnit: 7,
};

export class ValidationError extends AppError {
  constructor(public errors: Record<string, string>) {
    super(Object.values(errors)[0] || 'Please fix the highlighted fields.');
  }
}

export class DuplicateError extends AppError {
  constructor(public matches: Rec[], public field: string) {
    super(`A record with the same ${field} already exists.`);
  }
}

export interface SaveOptions {
  allowDuplicate?: boolean;
  /** The version the user started editing from. If the record has moved on since, the save is refused. */
  expectedVersion?: number;
}

type Listener = () => void;

const ITEM_ENTITIES = new Set(['quotations', 'invoices', 'purchaseOrders', 'dispatches']);

/** Document lines compared by what they say (product, description, HSN, qty, rate, GST, discount), not by layout. */
const linesKey = (items: unknown) => JSON.stringify((Array.isArray(items) ? items : []).filter((it) => it && typeof it === 'object')
  .map((it: Record<string, unknown>) => [String(it.productId || ''), String(it.description || '').trim(), String(it.hsn || '').trim(),
    Number(it.qty) || 0, Number(it.rate) || 0, Number(it.gstRate) || 0, Number(it.discountPct) || 0]));


/** The comparable form of a duplicate-checked value: phones ignore format, everything else ignores case and spaces. */
function dedupeKey(field: string, v: unknown): string {
  const s = String(v ?? '').trim();
  return field === 'phone' ? normalizePhone(s) : s.toLowerCase();
}

export class Store {
  private data: DataMap = {};
  private listeners = new Set<Listener>();
  private version = 0;
  user: AppUser | null = null;
  users: AppUser[] = [];
  /** Cloud mode: the business and its free trial / subscription (null in device mode). */
  business: BusinessInfo | null = null;
  /** Called when a save succeeded but a follow-up step (e.g. creating stock) did not. */
  onWarning: (message: string) => void = () => {};

  constructor(public backend: Backend) {}

  get mode() { return this.backend.mode; }

  async load() {
    // Cloud records are upgraded as they are read (device mode upgrades the stored data at start).
    this.data = await this.loadData();
    try { this.users = await this.backend.listUsers(); } catch { this.users = this.user ? [this.user] : []; }
    await this.refreshBusiness(false);
    this.emit();
  }

  /** Reads the business's trial / subscription again (after a payment, or when the app comes back to the front). */
  async refreshBusiness(notify = true) {
    if (!this.backend.businessInfo) return;
    try { this.business = await this.backend.businessInfo(); } catch { /* offline: keep what we had */ }
    if (notify) this.emit();
  }

  /** Cloud mode after the free trial or paid period: everything can be seen and exported, nothing changed. */
  get readOnly(): boolean {
    return !!this.business && !this.business.active;
  }

  /** The same words as the database's refusal (schema.sql ended_message), without the round trip. */
  private checkWritable() {
    if (this.readOnly) throw new AppError(ENDED_MESSAGE);
  }

  /** Forget everything (sign-out) so the next user never sees the previous user's data. */
  clear() {
    this.data = {};
    this.users = [];
    this.user = null;
    this.business = null;
    this.emit();
  }

  async refreshUsers() {
    this.users = await this.backend.listUsers();
    const me = this.users.find((u) => u.id === this.user?.id);
    if (me) this.user = me;
    this.emit();
  }

  async reload() {
    this.data = await this.loadData();
    this.emit();
  }

  /** Applies a change made by another user or tab without refetching everything. */
  applyRemote(c: RemoteChange) {
    if (c.kind === 'reload') { void this.reload().catch(() => {}); return; }
    if (c.kind === 'delete') {
      let changed = false;
      const next: DataMap = {};
      for (const [k, list] of Object.entries(this.data)) {
        const f = list.filter((r) => r.id !== c.id);
        if (f.length !== list.length) changed = true;
        next[k] = f;
      }
      if (changed) { this.data = next; this.emit(); }
      return;
    }
    const cur = this.get(c.entity, c.rec.id);
    if (cur && (cur.version ?? 0) >= (c.rec.version ?? 0)) return;
    this.put(c.entity, c.rec);
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  getVersion() { return this.version; }

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private warn(prefix: string, e: unknown) {
    this.onWarning(`${prefix}: ${e instanceof Error ? e.message : 'unknown error'}`);
  }

  private visible = new Map<string, { src: Rec[]; user: AppUser; list: Rec[] }>();

  /** Records of a type that the signed-in user may see ("own documents only" leaves out everyone else's). */
  all(entity: string): Rec[] {
    const list = this.data[entity] || [];
    const u = this.user;
    const e = u && getEntity(entity);
    if (!u || !e || levelOf(u, e.module) !== 'own') return list;
    const c = this.visible.get(entity);
    if (c && c.src === list && c.user === u) return c.list;
    const mine = list.filter((r) => isOwnRecord(r, u.id));
    this.visible.set(entity, { src: list, user: u, list: mine });
    return mine;
  }

  /** Every record, whoever may see it — only for integrity checks such as "is this still used somewhere?". */
  private everything(entity: string): Rec[] {
    return this.data[entity] || [];
  }

  // Lookups by id or by a linked field, built once per version of a list (lists are never changed in place),
  // so screens with thousands of records do not search every list again for every row.
  private idIndex = new WeakMap<Rec[], Map<string, Rec>>();
  private groupIndex = new WeakMap<Rec[], Map<string, Map<string, Rec[]>>>();

  get(entity: string, id: unknown): Rec | undefined {
    if (!id) return undefined;
    const list = this.all(entity);
    let m = this.idIndex.get(list);
    if (!m) { m = new Map(list.map((r) => [r.id, r])); this.idIndex.set(list, m); }
    return m.get(String(id));
  }

  /** Records of a type whose `field` equals `value` (e.g. payments of one invoice), from a cached index. */
  byField(entity: string, field: string, value: unknown): Rec[] {
    const list = this.all(entity);
    let fields = this.groupIndex.get(list);
    if (!fields) { fields = new Map(); this.groupIndex.set(list, fields); }
    let m = fields.get(field);
    if (!m) {
      m = new Map();
      for (const r of list) { const k = String(r[field] ?? ''); const g = m.get(k); if (g) g.push(r); else m.set(k, [r]); }
      fields.set(field, m);
    }
    return m.get(String(value ?? '')) || [];
  }

  titleOf(entity: string, id: unknown): string {
    const e = getEntity(entity);
    const r = this.get(entity, id);
    if (!e || !r) return id ? '(deleted)' : '—';
    const t = r[e.title];
    if (!t && !r.number && e.numberPrefix) return `Draft ${e.label.toLowerCase()}${r.date ? ` of ${formatDate(String(r.date))}` : ''}`;
    return String(t || r.number || r.id.slice(0, 8));
  }

  /** What a customer owes now: issued invoices less their payments (the closing figure of the statement). */
  balanceOf(customerId: string): number {
    let bal = 0;
    for (const i of this.byField('invoices', 'customerId', customerId)) {
      if (i.status === 'Cancelled' || i.status === 'Draft') continue;
      bal += this.computed('invoices', i).grandTotal - this.paidOn(i.id);
    }
    return round2(bal);
  }

  userName(id: unknown): string {
    if (!id) return '—';
    return this.users.find((u) => u.id === id)?.name || '(removed user)';
  }

  private settingsRec(): Rec | undefined {
    // If two rows ever exist, always use the oldest one so every device agrees.
    return [...this.all(SETTINGS)].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
  }

  settings(): CompanySettings {
    return { ...DEFAULT_SETTINGS, ...(this.settingsRec() || {}) } as CompanySettings;
  }

  async saveSettings(patch: Partial<CompanySettings>) {
    if (this.user && !isAdmin(this.user)) throw new AppError('Only the admin can change the company settings.');
    this.checkWritable();
    const existing = this.settingsRec();
    const now = new Date().toISOString();
    // Only settings values — never the record's id/version/dates, which would cause false conflicts.
    const clean: Partial<CompanySettings> = {};
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof CompanySettings)[]) {
      if (k in patch) (clean as Record<string, unknown>)[k] = patch[k];
    }
    if (clean.state !== undefined) clean.state = canonicalState(clean.state) || '';
    if (clean.whatsapp !== undefined && String(clean.whatsapp).trim()) {
      const n = waNumber(clean.whatsapp);
      if (!n) throw new AppError('Enter the business WhatsApp number as a 10-digit mobile number (or with its country code, like +971…).');
      clean.whatsapp = '+' + n;
    }
    if (clean.waTemplates !== undefined) {
      const t = clean.waTemplates && typeof clean.waTemplates === 'object' ? clean.waTemplates : {};
      clean.waTemplates = Object.fromEntries(Object.entries(t).filter(([k, v]) => /^\w{1,40}$/.test(k) && typeof v === 'string').map(([k, v]) => [k, String(v).slice(0, 1000)]));
    }
    // The state decides CGST + SGST or IGST on every bill, so it must agree with the GSTIN.
    const gst = String((clean.gstin ?? this.settings().gstin) || '');
    const fromGst = gst ? stateFromGstin(gst) : undefined;
    const st = clean.state !== undefined ? clean.state : canonicalState(this.settings().state);
    if (fromGst && st && fromGst !== st) throw new AppError(`The GSTIN is registered in ${fromGst}, but the state is ${st}. Correct one of them.`);
    if (fromGst && !st) clean.state = fromGst;
    try {
      if (existing) this.put(SETTINGS, await this.backend.update(SETTINGS, { ...existing, ...clean } as Rec));
      else this.put(SETTINGS, await this.backend.insert(SETTINGS, { ...DEFAULT_SETTINGS, ...clean, id: uid(), createdAt: now, updatedAt: now } as Rec));
    } catch (e) {
      if (e instanceof ConflictError) await this.reload();
      throw e;
    } finally {
      this.emit();
    }
  }

  private put(entity: string, rec: Rec) {
    const list = this.all(entity).slice();
    const i = list.findIndex((r) => r.id === rec.id);
    if (i >= 0) list[i] = rec; else list.push(rec);
    this.data = { ...this.data, [entity]: list };
  }

  // ---------------- computed values ----------------

  /**
   * Inter-state supply ⇒ IGST. Unknown company state ⇒ treated as intra-state (CGST + SGST).
   * Sales use the place of supply / customer state; purchases use the vendor's state.
   */
  /** The company's state: as entered, or else from its GSTIN (the first two digits). */
  companyState(): string {
    const st = this.settings();
    return canonicalState(st.state) || stateFromGstin(String(st.gstin || '')) || '';
  }

  interStateFor(rec: Record<string, unknown>): boolean {
    const own = this.companyState();
    const pos = rec.vendorId !== undefined && rec.customerId === undefined
      ? canonicalState(this.get('vendors', rec.vendorId)?.state)
      : canonicalState(rec.placeOfSupply) || canonicalState(this.get('customers', rec.customerId)?.state);
    return !!own && !!pos && own !== pos;
  }

  totalsFor(_entity: string, rec: Rec | Record<string, unknown>) {
    // Saved documents keep the tax type they were issued with, even if a state is edited later.
    const inter = typeof rec.interState === 'boolean' ? rec.interState : this.interStateFor(rec);
    return computeTotals(rec.items as LineItem[], Number(rec.discount) || 0, inter);
  }

  paidOn(invoiceId: string, excludePaymentId?: string): number {
    return round2(this.byField('payments', 'invoiceId', invoiceId)
      .filter((p) => p.id !== excludePaymentId)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0));
  }

  /** Paid on a purchase order: dated supplier payments, plus any amount typed on the order by older versions. */
  paidToSupplier(poId: string, po?: Rec, excludePaymentId?: string): number {
    const old = Number((po || this.get('purchaseOrders', poId))?.paidAmount) || 0;
    return round2(old + this.byField('supplierPayments', 'purchaseOrderId', poId)
      .filter((p) => p.id !== excludePaymentId).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  }

  stockOf(productId: string, excludeMoveId?: string): number {
    return round2(this.byField('stockMoves', 'productId', productId)
      .filter((m) => m.id !== excludeMoveId)
      .reduce((s, m) => s + (m.direction === 'Out' ? -1 : 1) * (Number(m.qty) || 0), 0));
  }

  /** Stock booked in one place: a warehouse, or '' for stock not in any warehouse. A place never goes below zero. */
  stockIn(productId: string, warehouseId: string, excludeMoveId?: string): number {
    return round2(this.byField('stockMoves', 'productId', productId)
      .filter((m) => m.id !== excludeMoveId && String(m.warehouseId || '') === warehouseId)
      .reduce((s, m) => s + (m.direction === 'Out' ? -1 : 1) * (Number(m.qty) || 0), 0));
  }

  /**
   * Where to take stock from when no warehouse is named: stock not in any warehouse first, then the fullest warehouse,
   * so no single place goes below zero. Returns the parts, or null when there is not enough in total.
   */
  takeFrom(productId: string, qty: number): { warehouseId: string; qty: number }[] | null {
    let left = round2(qty);
    const places = this.stockByWarehouse(productId).filter((p) => p.qty > 0)
      .sort((a, b) => (a.warehouseId === '' ? -1 : b.warehouseId === '' ? 1 : b.qty - a.qty));
    const out: { warehouseId: string; qty: number }[] = [];
    for (const p of places) {
      if (left <= 0) break;
      const take = round2(Math.min(left, p.qty));
      out.push({ warehouseId: p.warehouseId, qty: take });
      left = round2(left - take);
    }
    return left > 0.0001 ? null : out;
  }

  /** "(7 more is not in any warehouse — move it there first)" style hint for a short warehouse. */
  private elsewhere(productId: string, warehouseId: string): string {
    const other = round2(this.stockOf(productId) - this.stockIn(productId, warehouseId));
    return other > 0 ? ` (${other} more is in other places — move it there first with “Move between warehouses”)` : '';
  }

  /** Stock per warehouse ('' = not in any warehouse), leaving out empty places. */
  stockByWarehouse(productId: string): { warehouseId: string; qty: number }[] {
    const m = new Map<string, number>();
    for (const x of this.byField('stockMoves', 'productId', productId)) {
      const k = String(x.warehouseId || '');
      m.set(k, (m.get(k) || 0) + (x.direction === 'Out' ? -1 : 1) * (Number(x.qty) || 0));
    }
    return [...m].map(([warehouseId, qty]) => ({ warehouseId, qty: round2(qty) })).filter((x) => Math.abs(x.qty) > 0.0001);
  }

  /** Still to arrive on purchase orders that are ordered or partly received. */
  onOrder(productId: string): number {
    return round2(this.all('purchaseOrders').filter((o) => ['Ordered', 'Partially Received'].includes(String(o.status)))
      .reduce((s, o) => s + (remainingOf(o).get(productId) || 0), 0));
  }

  /** Quantity, value and moving-average cost of a product's stock. */
  stockValuation(productId: string): { qty: number; value: number; avg: number } {
    const p = this.get('products', productId);
    return valuation(this.byField('stockMoves', 'productId', productId), Number(p?.cost) || 0);
  }

  /** Stock entries a document made (receipts of a purchase order, issues and returns of a challan, a transfer). */
  movesFrom(sourceId: string): Rec[] {
    return this.byField('stockMoves', 'sourceId', sourceId);
  }

  computed(entity: string, rec: Rec): Record<string, number> {
    switch (entity) {
      case 'quotations':
      case 'purchaseOrders': {
        const grandTotal = this.totalsFor(entity, rec).grandTotal;
        const paid = this.paidToSupplier(rec.id, rec);
        return { grandTotal, paid, due: round2(Math.max(0, grandTotal - paid)) };
      }
      case 'dispatches':
        return { grandTotal: this.totalsFor(entity, rec).grandTotal };
      case 'invoices': {
        const total = this.totalsFor(entity, rec).grandTotal;
        // A cancelled invoice no longer counts as owed.
        return { grandTotal: total, balance: rec.status === 'Cancelled' ? 0 : round2(total - this.paidOn(rec.id)) };
      }
      case 'products':
        return { stock: this.stockOf(rec.id) };
      case 'loans':
        return { emi: computeEmi(Number(rec.amount), Number(rec.ratePct), Number(rec.tenureMonths)) };
      default:
        return {};
    }
  }

  computedText(entity: string, rec: Rec, key: string): string {
    if (entity === 'invoices' && key === 'paymentStatus') return this.paymentStatus(rec);
    return String(this.computed(entity, rec)[key] ?? '');
  }

  /** Paid status always comes from the recorded payments, never from a hand-set field. */
  paymentStatus(inv: Rec): string {
    if (inv.status === 'Cancelled') return 'Cancelled';
    const paid = this.paidOn(inv.id);
    const total = this.totalsFor('invoices', inv).grandTotal;
    if (paid <= 0) return inv.status === 'Draft' ? 'Draft' : 'Unpaid';
    return paid + 0.005 >= total ? 'Paid' : 'Partially Paid';
  }

  // ---------------- references ----------------

  referencesTo(entity: string, id: string): { entity: Entity; count: number }[] {
    const out: { entity: Entity; count: number }[] = [];
    for (const e of ENTITIES) {
      const refFields = e.fields.filter((f) => f.type === 'ref' && f.ref === entity);
      if (!refFields.length) continue;
      const count = this.everything(e.key).filter((r) => refFields.some((f) => r[f.key] === id)).length;
      if (count) out.push({ entity: e, count });
    }
    // A product is also used by the lines of quotations, invoices, orders and challans.
    if (entity === 'products') {
      for (const key of ITEM_ENTITIES) {
        const count = this.everything(key).filter((r) => Array.isArray(r.items) && (r.items as LineItem[]).some((it) => it?.productId === id)).length;
        const e = getEntity(key);
        if (count && e) out.push({ entity: e, count });
      }
    }
    return out;
  }

  findDuplicates(entity: Entity, data: Record<string, unknown>, selfId?: string): { field: string; matches: Rec[] } | null {
    for (const key of entity.dedupe || []) {
      const v = data[key];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      const target = dedupeKey(key, v);
      const matches = this.all(entity.key).filter((r) => r.id !== selfId && r[key] && dedupeKey(key, r[key]) === target);
      if (matches.length) return { field: entity.fields.find((f) => f.key === key)?.label || key, matches };
    }
    return null;
  }

  // ---------------- writes ----------------

  /** True while an invoice is still a draft (or cancelled before it was ever issued): it has no number yet. */
  numberOnIssue(entity: Entity, data: Record<string, unknown>): boolean {
    return entity.key === 'invoices' && ['Draft', 'Cancelled'].includes(String(data.status || 'Draft'));
  }

  numberingFor(entity: Entity, data: Record<string, unknown>): Numbering | undefined {
    if (!entity.numberPrefix) return undefined;
    if (entity.fyNumberField) {
      const fy = financialYear(String(data[entity.fyNumberField] || todayIso()));
      return { key: `${entity.key}:${fy}`, prefix: `${entity.numberPrefix}/${fy}/` };
    }
    return { key: entity.key, prefix: `${entity.numberPrefix}-` };
  }

  private checkBusinessRules(entity: Entity, data: Record<string, unknown>, before?: Rec) {
    const errors: Record<string, string> = {};
    const selfId = before?.id;
    if (entity.key === 'stockMoves' && data.productId) {
      const product = this.get('products', data.productId);
      // (A document undoing what really happened — e.g. a return — is always allowed.)
      if (product && !tracksStock(product) && !data.sourceId) errors.productId = `${String(product.name)} is a service, so no stock is kept for it.`;
      if (data.direction === 'Out' && !data.warehouseId && !data.sourceId) {
        // Taken out by hand without naming a warehouse: only from stock that is not in any warehouse.
        const loose = this.stockIn(String(data.productId), '', selfId);
        if (loose < (Number(data.qty) || 0) && this.stockOf(String(data.productId), selfId) >= (Number(data.qty) || 0)) {
          errors.warehouseId = `Choose the warehouse it comes from — only ${loose} is not in any warehouse.`;
        }
      }
      if (data.direction === 'Out' && data.warehouseId) {
        const here = this.stockIn(String(data.productId), String(data.warehouseId), selfId);
        if (here < (Number(data.qty) || 0)) errors.qty = `Only ${here} in ${this.titleOf('warehouses', data.warehouseId)} — cannot take out ${data.qty}${this.elsewhere(String(data.productId), String(data.warehouseId))}.`;
      }
      // Whatever the change (new, edited or re-pointed entry), stock may never go below zero.
      const sign = data.direction === 'Out' ? -1 : 1;
      const after = round2(this.stockOf(String(data.productId), selfId) + sign * (Number(data.qty) || 0));
      if (after < 0) {
        errors.qty = data.direction === 'Out'
          ? `Only ${this.stockOf(String(data.productId), selfId)} in stock — cannot dispatch ${data.qty}.`
          : `This change would make stock negative (${after}).`;
      }
      if (before?.productId && before.productId !== data.productId && this.stockOf(String(before.productId), selfId) < 0) {
        errors.productId = 'Moving this entry would make the previous product’s stock negative.';
      }
      if (before?.productId && before.direction !== 'Out') {
        const wh = String(before.warehouseId || '');
        let left = this.stockIn(String(before.productId), wh, selfId);
        if (data.productId === before.productId && String(data.warehouseId || '') === wh) left += sign * (Number(data.qty) || 0);
        if (round2(left) < 0) errors.warehouseId = `This change would leave ${wh ? this.titleOf('warehouses', wh) : 'the stock not in any warehouse'} with ${round2(left)} — stock there was already used.`;
      }
    }
    if (entity.key === 'products') {
      // An SKU names one product only (it is how imports, labels and the stores find it).
      const sku = String(data.sku || '').trim().toLowerCase();
      const other = sku ? this.all('products').find((p) => p.id !== selfId && String(p.sku || '').trim().toLowerCase() === sku) : undefined;
      if (other) errors.sku = `SKU ${String(data.sku).trim()} is already used by ${String(other.name)}.`;
      // Stock counted in one unit cannot silently become another (10 panels must not turn into 10 watts).
      if (before && String(data.unit || 'Nos') !== String(before.unit || 'Nos') && tracksStock(before) && tracksStock(data as Rec)
        && this.byField('stockMoves', 'productId', before.id).length) {
        errors.unit = `This product's stock is kept in “${String(before.unit || 'Nos')}”, so its unit can no longer be changed. Make a new product for another unit.`;
      }
    }
    if (entity.key === 'products' && before && tracksStock(before) && !tracksStock(data as Rec)) {
      const held = this.stockOf(before.id);
      const k = data.noStock && !before.noStock ? 'noStock' : data.category !== before.category ? 'category' : 'unit';
      if (Math.abs(held) > 0.0001) errors[k] = `${held} of this product are still in stock. Book them out (stock count) before making it a service or no-stock item.`;
    }
    // An invoiced quotation is a done deal (like a confirmed order): its lines and price are locked.
    if (entity.key === 'quotations' && before?.invoiceId && this.get('invoices', before.invoiceId)?.status !== 'Cancelled') {
      if (linesKey(data.items) !== linesKey(before.items) || Number(data.discount || 0) !== Number(before.discount || 0)) {
        errors.items = 'This quotation is already invoiced, so its lines and price can no longer be changed. Make a new quotation for a revised offer.';
      }
      if (data.customerId !== before.customerId) errors.customerId = 'This quotation is already invoiced; its customer can no longer be changed.';
    }
    if (entity.key === 'purchaseOrders') {
      const got = before ? Object.values(receivedOf(before)).some((q) => Number(q) > 0) : false;
      if (got && linesKey(data.items) !== linesKey(before!.items)) {
        errors.items = 'Goods on this order were already received, so its items can no longer be changed. Create a new order for extra material.';
      }
      if (before?.stockReceived && data.status !== 'Received' && data.status !== before.status) {
        errors.status = 'This order was already received into stock. Its status can no longer be changed.';
      } else if (got && data.status === 'Cancelled') {
        errors.status = 'Part of this order was already received, so it cannot be cancelled. Return goods to the vendor with a stock entry.';
      } else if (got && ['Draft', 'Ordered'].includes(String(data.status))) {
        errors.status = 'Part of this order was already received. Its status stays “Partially Received” until the rest arrives.';
      }
      if (got && Number(data.discount || 0) !== Number(before!.discount || 0)) errors.discount = 'Goods on this order were already received at its price, so its discount can no longer be changed.';
      if (got && data.vendorId !== before!.vendorId) errors.vendorId = 'Goods on this order were already received from this vendor.';
      if (before) {
        const paidOut = this.paidToSupplier(before.id, before);
        const payments = this.byField('supplierPayments', 'purchaseOrderId', before.id).length;
        if (payments && data.status === 'Cancelled' && before.status !== 'Cancelled') {
          errors.status = 'Payments to the vendor are recorded on this order. Delete those supplier payments before cancelling it.';
        }
        const total = this.totalsFor('purchaseOrders', data).grandTotal;
        if (paidOut > total + 0.005) errors.items = `Order total (${total}) cannot be less than what was already paid to the vendor (${paidOut}).`;
      }
      if (data.status === 'Received' && !before?.stockReceived && this.user && !canWrite(this.user, 'inventory')) {
        errors.status = 'Receiving goods adds them to stock, and your access rights do not include Inventory. Ask a store or inventory user.';
      }
    }
    if (entity.key === 'dispatches') {
      const issuing = ['Dispatched', 'Delivered'].includes(String(data.status)) && !before?.stockIssued;
      if (before?.stockIssued && data.status !== 'Cancelled' && JSON.stringify(data.items) !== JSON.stringify(before.items)) {
        errors.items = 'This material was already taken out of stock. Cancel this challan and make a new one to change it.';
      }
      if (before?.status === 'Cancelled' && data.status !== 'Cancelled') errors.status = 'A cancelled challan cannot be reopened. Make a new one.';
      else if (before?.stockIssued && !['Dispatched', 'Delivered', 'Cancelled'].includes(String(data.status))) {
        errors.status = 'This material already left the store. Mark the challan Delivered, or Cancel it to put the stock back.';
      }
      if (before?.stockIssued && data.warehouseId !== before.warehouseId) errors.warehouseId = 'The material already left this warehouse; the warehouse can no longer be changed.';
      if (issuing) {
        const short: string[] = [];
        const wh = String(data.warehouseId || '');
        for (const [pid, qty] of qtyByProduct(data.items)) {
          const p = this.get('products', pid);
          if (p && !tracksStock(p)) continue;
          const have = wh ? this.stockIn(pid, wh) : this.stockOf(pid);
          if (have < qty) short.push(`${p ? String(p.name) : 'a deleted product'} (need ${qty}, have ${have}${wh ? ` in ${this.titleOf('warehouses', wh)}${this.elsewhere(pid, wh)}` : ''})`);
        }
        if (short.length) errors.items = `Not enough stock: ${short.join(', ')}.`;
      }
    }
    if (entity.key === 'supplierPayments') {
      const po = data.purchaseOrderId ? this.get('purchaseOrders', data.purchaseOrderId) : undefined;
      if (data.purchaseOrderId && !po) errors.purchaseOrderId = 'Choose an existing purchase order';
      else if (po) {
        if (po.status === 'Cancelled' && (!before || before.purchaseOrderId !== data.purchaseOrderId)) errors.purchaseOrderId = 'This order is cancelled';
        if (data.vendorId && po.vendorId && data.vendorId !== po.vendorId) errors.vendorId = 'This order is from another vendor';
        const due = round2(this.computed('purchaseOrders', po).grandTotal - this.paidToSupplier(po.id, po, selfId));
        if ((Number(data.amount) || 0) > due + 0.005) errors.amount = `More than is still to pay on ${po.number} (${due.toLocaleString('en-IN', { maximumFractionDigits: 2 })})`;
      }
    }
    if (entity.key === 'payments' && data.invoiceId) {
      const inv = this.get('invoices', data.invoiceId);
      if (!inv) errors.invoiceId = 'Choose an existing invoice';
      else if (inv.status === 'Cancelled') errors.invoiceId = 'This invoice is cancelled';
      else {
        const balance = round2(this.totalsFor('invoices', inv).grandTotal - this.paidOn(inv.id, selfId));
        if (Number(data.amount) > balance + 0.005) errors.amount = `Amount is more than the balance due (${balance}).`;
        // A payment issues a draft invoice, which needs its place of supply first.
        if (!inv.number && this.companyState() && !canonicalState(inv.placeOfSupply) && !canonicalState(this.get('customers', inv.customerId)?.state)) {
          errors.invoiceId = 'This draft invoice has no place of supply yet. Open it and tap “Issue invoice” first (a payment issues it).';
        }
      }
    }
    if (ITEM_ENTITIES.has(entity.key) && Number(data.discount) > 0) {
      const sub = computeTotals(data.items as LineItem[], 0, false).subtotal;
      if (Number(data.discount) > sub + 0.005) errors.discount = `The discount (${Number(data.discount)}) is more than the value of the lines (${sub}).`;
    }
    if (entity.key === 'invoices' && !before?.number && !this.numberOnIssue(entity, data) && this.companyState()) {
      const pos = canonicalState(data.placeOfSupply) || canonicalState(this.get('customers', data.customerId)?.state);
      if (!pos) errors.placeOfSupply = 'Choose the place of supply (the state where the system is installed) before issuing: it decides CGST + SGST or IGST.';
    }
    if (entity.key === 'invoices' && before?.number) {
      const no = String(before.number);
      if (before.status === 'Cancelled' && data.status !== 'Cancelled') errors.status = `${no} is cancelled, and a cancelled invoice cannot be used again. Make a new invoice.`;
      else if (data.status === 'Draft') errors.status = `${no} is already issued, so it cannot go back to Draft. Cancel it if it should not count.`;
      if (linesKey(data.items) !== linesKey(before.items) || Number(data.discount || 0) !== Number(before.discount || 0)) {
        errors.items = `${no} is already issued, so its lines and price can no longer be changed (GST rules). Cancel it and make a new invoice.`;
      }
      if (data.customerId !== before.customerId) errors.customerId = `${no} is already issued; its customer can no longer be changed.`;
      if (String(data.placeOfSupply || '') !== String(before.placeOfSupply || '')) errors.placeOfSupply = `${no} is already issued; its place of supply (and so its tax) can no longer be changed.`;
      if (String(data.date || '') !== String(before.date || '')) errors.date = `${no} is already issued; its date can no longer be changed.`;
    }
    if (entity.key === 'invoices' && selfId) {
      const paid = this.paidOn(selfId);
      const total = this.totalsFor('invoices', data).grandTotal;
      if (paid > total + 0.005) errors.items = `Invoice total (${total}) cannot be less than the amount already received (${paid}).`;
      if (paid > 0 && data.status === 'Cancelled') errors.status = 'Delete the payments on this invoice before cancelling it.';
    }
    if (entity.fyNumberField && before?._numKey && data[entity.fyNumberField]) {
      const fy = financialYear(String(data[entity.fyNumberField]));
      if (fy && String(before._numKey) !== `${entity.key}:${fy}`) {
        errors[entity.fyNumberField] = `${before.number} belongs to another financial year. Create a new ${entity.label.toLowerCase()} instead.`;
      }
    }
    if (data.whatsapp && !waNumber(data.whatsapp)) errors.whatsapp = 'WhatsApp needs a mobile number (a landline has no WhatsApp).';
    if (entity.key === 'customers' || entity.key === 'vendors') {
      const fromGstin = stateFromGstin(data.gstin);
      if (data.gstin && fromGstin && data.state && canonicalState(data.state) !== fromGstin) {
        errors.state = `This GSTIN is registered in ${fromGstin}.`;
      }
    }
    for (const f of entity.fields.filter((x) => x.type === 'ref' && x.ref)) {
      const v = data[f.key];
      if (v && v !== before?.[f.key] && !this.get(f.ref!, v)) errors[f.key] = `The selected ${f.label.toLowerCase()} no longer exists`;
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);
  }

  private checkPermission(entity: Entity, before?: Rec) {
    const u = this.user;
    if (!u) return;
    if (!canWrite(u, entity.module)) throw new AppError(`Your access rights do not allow changing ${entity.plural.toLowerCase()}.`);
    if (before && levelOf(u, entity.module) === 'own' && !isOwnRecord(before, u.id)) {
      throw new AppError(`You can only change ${entity.plural.toLowerCase()} that you created or that are assigned to you.`);
    }
  }

  private prepare(entity: Entity, input: Record<string, unknown>, before?: Rec, opts?: SaveOptions) {
    const data = coerce(entity, input);
    // A supplier payment against an order is to that order's vendor.
    if (entity.key === 'supplierPayments' && data.purchaseOrderId && !data.vendorId) {
      const po = this.get('purchaseOrders', data.purchaseOrderId);
      if (po?.vendorId) data.vendorId = po.vendorId;
    }
    if ((entity.key === 'customers' || entity.key === 'vendors') && !data.state && data.gstin) {
      const s = stateFromGstin(data.gstin);
      if (s) data.state = s;
    }
    // PM Surya Ghar: the system size comes from the customer's project or accepted quotation, and the subsidy from
    // the scheme's slabs, when they are left empty (an amount typed in is kept: housing societies get other rates).
    if (entity.key === 'subsidies' && isPmSuryaGhar(data.scheme) && data.customerId) {
      if (!(Number(data.capacityKw) > 0)) { const kw = this.systemKwOf(String(data.customerId)); if (kw) data.capacityKw = kw; }
      const empty = data.amount === undefined || data.amount === null || data.amount === '';
      const typed = !empty && (!before || Number(data.amount) !== Number(before.amount));
      if ((empty || (before?.amountAuto && !typed)) && Number(data.capacityKw) > 0 && data.status !== 'Rejected') {
        data.amount = pmSuryaGharSubsidy(Number(data.capacityKw), this.get('customers', data.customerId)?.state);
        data.amountAuto = true;
      } else if (typed) data.amountAuto = false;
    }
    // A product's GST rate and HSN, when not given (an import, an older screen), follow its category.
    if (entity.key === 'products') {
      const t = taxFor(data.category);
      if (data.gstRate === undefined || data.gstRate === null || data.gstRate === '') data.gstRate = t.gst;
      if (!String(data.hsn ?? '').trim() && t.hsn) data.hsn = t.hsn;
    }
    if (entity.key === 'dispatches' && !data.customerId && data.projectId) {
      const c = this.get('projects', data.projectId)?.customerId;
      if (c) data.customerId = c;
    }
    const errors = validateRecord(entity, data);
    if (Object.keys(errors).length) throw new ValidationError(errors);
    this.checkBusinessRules(entity, data, before);
    if (!opts?.allowDuplicate) {
      // On an edit, only ask again if a duplicate-checked field (phone, email…) was actually changed.
      const same = (k: string, a: unknown, b: unknown) => dedupeKey(k, a) === dedupeKey(k, b);
      const check = before
        ? Object.fromEntries((entity.dedupe || []).filter((k) => !same(k, data[k], before[k])).map((k) => [k, data[k]]))
        : data;
      const dup = this.findDuplicates(entity, check, before?.id);
      if (dup) throw new DuplicateError(dup.matches, dup.field);
    }
    if (ITEM_ENTITIES.has(entity.key)) {
      // Freeze the tax type and total so issued documents never change on their own.
      const taxInputsChanged = !before || before.customerId !== data.customerId || before.placeOfSupply !== data.placeOfSupply
        || before.vendorId !== data.vendorId || typeof before.interState !== 'boolean'
        || (entity.key === 'invoices' && !before.number) || (entity.key === 'quotations' && !before.invoiceId);
      if (!taxInputsChanged) {
        // An issued document keeps its tax type even if company or customer state changes later.
        data.interState = before!.interState;
      } else if (entity.key === 'purchaseOrders') {
        data.interState = this.interStateFor({ vendorId: data.vendorId });
      } else {
        if (!data.placeOfSupply && entity.fields.some((f) => f.key === 'placeOfSupply')) {
          const cs = canonicalState(this.get('customers', data.customerId)?.state);
          if (cs) data.placeOfSupply = cs;
        }
        data.interState = this.interStateFor(data);
      }
      data.grandTotal = computeTotals(data.items as LineItem[], Number(data.discount) || 0, data.interState === true).grandTotal;
    }
    return data;
  }

  /** What issuing a draft invoice changes: it becomes Sent and, if older, takes the issue date (its due date moves along). */
  issuePatch(inv: Rec, onDate = todayIso()): Record<string, unknown> {
    const patch: Record<string, unknown> = { status: 'Sent' };
    const d = String(inv.date || '');
    if (d && d < onDate) {
      patch.date = onDate;
      if (inv.dueDate) patch.dueDate = addDaysIso(onDate, Math.round((Date.parse(String(inv.dueDate)) - Date.parse(d)) / 86400000));
    }
    return patch;
  }

  /** The customer's solar system size: their latest project with a capacity, else their latest accepted quotation. */
  private systemKwOf(customerId: string): number {
    const latest = (list: Rec[], f: string) => list.filter((r) => Number(r[f]) > 0).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const p = latest(this.byField('projects', 'customerId', customerId), 'capacityKw');
    if (p) return Number(p.capacityKw);
    const q = latest(this.byField('quotations', 'customerId', customerId).filter((r) => r.status === 'Accepted'), 'systemKw');
    return q ? Number(q.systemKw) : 0;
  }

  /** Fills a blank state from the PIN code. The PIN table is large, so it is only loaded when needed. */
  private async fillStateFromPin(entity: Entity, data: Record<string, unknown>) {
    if (!entity.fields.some((f) => f.key === 'pincode') || !entity.fields.some((f) => f.key === 'state')) return;
    const pin = String(data.pincode ?? '').replace(/\s/g, '');
    if (data.state || !/^[1-9]\d{5}$/.test(pin)) return;
    try {
      const { stateFromPincode } = await import('../geo/indiaMap');
      const st = stateFromPincode(pin);
      if (st) data.state = st;
    } catch { /* offline before the map data was ever loaded: leave the state blank */ }
  }

  private pickAssignee(): string | undefined {
    const sales = this.users.filter((u) => u.active && u.role === 'sales');
    if (!sales.length) return this.user?.id;
    const open = this.all('leads').filter((l) => !['Won', 'Lost'].includes(String(l.status)));
    return sales
      .map((u) => ({ id: u.id, n: open.filter((l) => l.assignedTo === u.id).length }))
      .sort((a, b) => a.n - b.n || a.id.localeCompare(b.id))[0].id;
  }

  async create(entityKey: string, input: Record<string, unknown>, opts?: SaveOptions): Promise<Rec> {
    const entity = getEntity(entityKey);
    if (!entity) throw new AppError('Unknown module');
    this.checkPermission(entity);
    this.checkWritable();
    // Stock entered by hand (opening stock, counts, damage…) changes the books, so only inventory managers may.
    if (entityKey === 'stockMoves' && !input.sourceId && this.user && !canDelete(this.user, 'inventory')) {
      throw new AppError('Only an inventory manager can add stock entries by hand. Stock comes in with purchase orders and goes out with delivery challans.');
    }
    const withDefaults: Record<string, unknown> = {};
    for (const f of entity.fields) if (f.default !== undefined) withDefaults[f.key] = f.default;
    // A product's GST rate comes from its category (panels 5%…), not from the general default.
    if (entityKey === 'products' && input.category) withDefaults.gstRate = taxFor(input.category).gst;
    const merged = { ...withDefaults, ...input };
    await this.fillStateFromPin(entity, merged);
    if (entityKey === 'invoices' && !merged.dueDate && merged.date) {
      const terms = Number(this.settings().paymentTermsDays);
      merged.dueDate = addDaysIso(String(merged.date), Number.isFinite(terms) && terms >= 0 ? terms : 15); // 0 = due on receipt
    }
    if (entityKey === 'quotations' && !merged.validTill && merged.date && Number(this.settings().quoteValidDays) > 0) {
      merged.validTill = addDaysIso(String(merged.date), Number(this.settings().quoteValidDays));
    }
    if (entityKey === 'surveys' && !merged.surveyor && this.settings().defaultSurveyor && this.users.some((u) => u.id === this.settings().defaultSurveyor && u.active)) {
      merged.surveyor = this.settings().defaultSurveyor;
    }
    const data = this.prepare(entity, merged, undefined, opts);
    if (entityKey === 'leads' && !data.assignedTo && this.settings().autoAssignLeads) data.assignedTo = this.pickAssignee();
    delete data.number;

    const now = new Date().toISOString();
    const rec: Rec = { ...data, id: uid(), createdAt: now, updatedAt: now, createdBy: this.user?.id };
    delete rec.version;
    // An invoice gets its number when it is issued, not while it is a draft: drafts never leave gaps in the series.
    const saved = await this.backend.insert(entityKey, rec, this.numberOnIssue(entity, data) ? undefined : this.numberingFor(entity, data));
    this.put(entityKey, saved);
    await this.logActivity(entityKey, saved.id, { kind: 'created', text: `Created ${entity.label.toLowerCase()}${saved.number ? ` ${saved.number}` : ''}` });
    try {
      await this.afterSave(entityKey, saved, undefined);
    } finally {
      this.emit();
    }
    return this.get(entityKey, saved.id) || saved;
  }

  async update(entityKey: string, id: string, patch: Record<string, unknown>, opts?: SaveOptions): Promise<Rec> {
    const entity = getEntity(entityKey);
    const before = this.get(entityKey, id);
    if (!entity || !before) throw new AppError('This record no longer exists. It may have been deleted.');
    this.checkWritable();
    this.checkPermission(entity, before);
    if (entityKey === 'stockMoves' && before.sourceId) throw new AppError(`This entry was made by ${String(before.reference || 'a purchase order or challan')}. Change it there.`);
    // Live updates keep the cache current, so compare against the version the user actually started from.
    if (opts?.expectedVersion !== undefined && (before.version ?? 1) !== opts.expectedVersion) throw new ConflictError();
    const { version: _ignore, ...rest } = patch;
    if ('pincode' in rest && !('state' in rest ? rest.state : before.state)) await this.fillStateFromPin(entity, rest);
    const data = this.prepare(entity, { ...before, ...rest }, before, opts);
    const rec: Rec = { ...before, ...data, id, number: before.number, createdAt: before.createdAt, version: before.version };
    let saved: Rec;
    const issuing = entity.key === 'invoices' && !before.number && !this.numberOnIssue(entity, rec) ? this.numberingFor(entity, rec) : undefined;
    try {
      saved = await this.backend.update(entityKey, rec, issuing);
    } catch (e) {
      if (e instanceof ConflictError) await this.reload().catch(() => {});
      throw e;
    }
    if (issuing && !saved.number) {
      // A cloud database set up before invoices were numbered on issue ignores the request. Never leave an issued
      // invoice without a number: put it back as it was and say what to do.
      try { saved = await this.backend.update(entityKey, { ...before, version: saved.version }); } catch { /* the message below still applies */ }
      this.put(entityKey, saved);
      this.emit();
      throw new AppError('The invoice could not get its number, so it was left as a draft. The database needs updating: ask your admin to run supabase/schema.sql again (see the upgrade notes).');
    }
    this.put(entityKey, saved);
    const changes = this.describeChanges(entity, before, saved);
    if (changes.length) await this.logActivity(entityKey, id, { kind: 'changed', changes });
    try {
      await this.afterSave(entityKey, saved, before);
    } finally {
      this.emit();
    }
    return this.get(entityKey, id) || saved;
  }

  async remove(entityKey: string, id: string): Promise<void> {
    const entity = getEntity(entityKey);
    if (entity) this.checkPermission(entity, this.get(entityKey, id));
    this.checkWritable();
    if (entity && this.user && !canDelete(this.user, entity.module)) {
      throw new AppError(`Only a manager of this app can delete ${entity.plural.toLowerCase()}. You can cancel or edit it instead.`);
    }
    if (entity?.noDelete) throw new AppError(`${entity.plural} cannot be deleted. Change the status to Cancelled instead.`);
    const refs = this.referencesTo(entityKey, id);
    if (refs.length) {
      const what = refs.map((r) => `${r.count} ${r.count === 1 ? r.entity.label.toLowerCase() : r.entity.plural.toLowerCase()}`).join(', ');
      throw new AppError(`Cannot delete: it is used by ${what}. Delete or reassign those first.`);
    }
    const rec = this.get(entityKey, id);
    if (entityKey === 'stockMoves' && rec?.sourceId) throw new AppError(`This entry was made by ${String(rec.reference || 'a purchase order or challan')} and cannot be deleted on its own.`);
    if ((entityKey === 'purchaseOrders' || entityKey === 'dispatches') && rec && (this.movesFrom(id).length || rec.stockIssued || rec.stockReceived)) {
      throw new AppError(entityKey === 'dispatches'
        ? 'Stock was issued with this challan, so it is kept for the record. Cancel it instead.'
        : 'Goods were received on this order, so it is kept for the record.');
    }
    if (entityKey === 'stockMoves' && rec && rec.direction !== 'Out' && rec.productId && this.stockOf(String(rec.productId), id) < 0) {
      throw new AppError('Deleting this entry would make stock negative.');
    }
    if (entityKey === 'stockMoves' && rec && rec.direction !== 'Out' && rec.productId && this.stockIn(String(rec.productId), String(rec.warehouseId || ''), id) < -0.0001) {
      throw new AppError(`Deleting this entry would make the stock in ${rec.warehouseId ? this.titleOf('warehouses', rec.warehouseId) : 'no warehouse'} negative — it was already used.`);
    }
    await this.backend.remove(entityKey, id);
    this.data = { ...this.data, [entityKey]: this.all(entityKey).filter((r) => r.id !== id) };
    this.emit();
    // The record is gone, so its uploaded files are no longer reachable: delete them too.
    if (rec && entity && this.backend.removeFile) {
      for (const f of entity.fields.filter((x) => x.type === 'file')) {
        const ref = rec[f.key] as FileRef | undefined;
        // Never a file another record still uses (the same file can be attached twice, or a path copied).
        const shared = !!ref?.path && Object.values(this.data).some((list) => list.some((r) => r.id !== rec.id && JSON.stringify(r).includes(JSON.stringify(ref.path))));
        if (ref && typeof ref === 'object' && ref.path && !shared) {
          try { await this.backend.removeFile(ref); }
          catch (e) { this.warn('Record deleted, but its file could not be removed from storage', e); }
        }
      }
    }
  }

  /** Follow-up steps. The main save has already succeeded, so failures here are warnings, not errors. */
  private async afterSave(entity: string, rec: Rec, before: Rec | undefined) {
    if (entity === 'payments') {
      const inv = this.get('invoices', rec.invoiceId);
      if (inv?.status === 'Draft') {
        try { await this.update('invoices', inv.id, this.issuePatch(inv, String(rec.date || todayIso())), { allowDuplicate: true }); }
        catch (e) { this.warn('Payment saved, but the invoice could not be marked as sent', e); }
      }
    }
    if (entity === 'leads' && rec.status === 'Won' && before?.status !== 'Won' && this.settings().autoCreateCustomer && !rec.customerId) {
      try { await this.convertLead(rec.id); }
      catch (e) { this.warn('Lead saved, but the customer could not be created — use “Convert to customer”', e); }
    }
    if (entity === 'dispatches' && ['Dispatched', 'Delivered'].includes(String(rec.status)) && !rec.stockIssued) {
      try { await this.issueDispatch(rec.id, ['Dispatched', 'Delivered'].includes(String(before?.status)) ? 'Draft' : String(before?.status || 'Draft')); }
      catch (e) { this.warn('Stock could not be taken out, so the challan was put back as it was. Try again', e); }
    }
    if (entity === 'dispatches' && rec.status === 'Cancelled' && rec.stockIssued) {
      try { await this.returnDispatch(rec.id); }
      catch (e) { this.warn('Challan cancelled, but not all stock could be put back yet. Save the challan again to finish', e); }
    }
    if (entity === 'purchaseOrders' && rec.status === 'Received' && !rec.stockReceived) {
      // If receiving fails, the order goes back to the status it had before this save, so it can be received again.
      try { await this.receiveGoods(rec.id, undefined, { statusBefore: String(before?.status || 'Ordered') === 'Received' ? 'Ordered' : String(before?.status || 'Ordered') }); }
      catch (e) { this.warn('Order saved, but stock could not be added — use “Receive goods” on the order', e); }
    }
  }

  // ---------------------------------------------------------------- stock flows
  // Every entry a document makes carries sourceType/sourceId and a reason, so it can be traced, is never
  // edited on its own, and a cancel or return undoes exactly what really happened.

  /**
   * Goods arrived for a purchase order: adds what came (all that is still due unless given) into stock at the
   * order's cost, into its warehouse, and works out the order's status.
   */
  async receiveGoods(poId: string, qtys?: Record<string, number>, opts: { date?: string; warehouseId?: string; statusBefore?: string } = {}): Promise<number> {
    const po = this.get('purchaseOrders', poId);
    if (!po) throw new AppError('Purchase order not found');
    if (po.status === 'Cancelled') throw new AppError('This order is cancelled.');
    if (this.user && !canWrite(this.user, 'inventory')) throw new AppError('Receiving goods adds them to stock, and your access rights do not include Inventory.');
    const left = remainingOf(po);
    const gone = [...left.keys()].filter((pid) => pid && !this.get('products', pid));
    if (gone.length) throw new AppError('A product on this order was deleted, so it cannot be received into stock. Add the product again and correct the order.');
    const lines: [string, number][] = [];
    for (const [pid, due] of left) {
      if (!tracksStock(this.get('products', pid))) continue;
      const want = qtys ? round2(Number(qtys[pid]) || 0) : due;
      if (want < 0) throw new AppError('Quantities cannot be negative.');
      if (want > due + 0.0001) throw new AppError(`${this.titleOf('products', pid)}: only ${due} still due on this order.`);
      if (want > 0) lines.push([pid, want]);
    }
    if (qtys && Object.keys(qtys).some((pid) => !left.has(pid) && Number(qtys[pid]) > 0)) throw new AppError('Some of those items are not due on this order.');
    if (qtys && !lines.length) return 0; // nothing arrived: the order stays as it is
    // Services on the order count as received with the goods.
    const services = [...left].filter(([pid]) => !tracksStock(this.get('products', pid)));
    const got = { ...receivedOf(po) };
    for (const [pid, q] of [...lines, ...(qtys ? [] : services)]) got[pid] = round2((Number(got[pid]) || 0) + q);
    const full = [...qtyByProduct(po.items)].every(([pid, q]) => (Number(got[pid]) || 0) >= q - 0.0001 || !tracksStock(this.get('products', pid)));
    const status = full ? 'Received' : 'Partially Received';
    // A warehouse that was deleted meanwhile is ignored rather than failing the receipt.
    const whWanted = String(opts.warehouseId ?? po.warehouseId ?? this.settings().defaultWarehouse ?? '') || '';
    const warehouseId = whWanted && this.get('warehouses', whWanted) ? whWanted : '';
    const before = po;
    // The order is updated first (its version check stops two people receiving the same goods twice)…
    const marked = await this.backend.update('purchaseOrders', { ...po, received: got, status, stockReceived: full });
    this.put('purchaseOrders', marked);
    // Order price per unit after line discounts and the order's own discount, before GST.
    const t = this.totalsFor('purchaseOrders', po);
    const share = t.subtotal > 0 ? t.taxable / t.subtotal : 1;
    const cost = new Map([...unitCostByProduct(po.items)].map(([p, c]) => [p, round2(c * share)]));
    const date = opts.date || todayIso();
    let done = 0;
    try {
      for (const [productId, qty] of lines) {
        await this.create('stockMoves', {
          productId, direction: 'In', qty, date, rate: cost.get(productId) ?? null, warehouseId,
          reason: 'Purchase receipt', sourceType: 'purchaseOrders', sourceId: po.id, reference: `PO ${po.number || ''}`.trim(),
        });
        done++;
      }
    } catch (e) {
      // …and put back as it was for whatever could not be added, so nothing is counted that is not in stock.
      const back = { ...receivedOf(before) };
      for (const [pid, q] of lines.slice(0, done)) back[pid] = round2((Number(back[pid]) || 0) + q);
      const now = this.get('purchaseOrders', po.id)!;
      try { this.put('purchaseOrders', await this.backend.update('purchaseOrders', { ...now, received: back, status: done ? 'Partially Received' : (opts.statusBefore ?? before.status), stockReceived: false })); } catch { /* reported below */ }
      this.emit();
      throw e;
    }
    if (before.status !== status) await this.logActivity('purchaseOrders', po.id, { kind: 'changed', changes: [{ field: 'status', label: 'Status', from: String(before.status || '—'), to: status }] });
    if (lines.length) this.onWarning(`Added ${lines.length} item(s) from ${po.number} to stock.`);
    this.emit();
    return lines.length;
  }

  private async issueDispatch(id: string, statusBefore = 'Draft') {
    const dc = this.get('dispatches', id)!;
    const lines = [...qtyByProduct(dc.items)].filter(([pid]) => tracksStock(this.get('products', pid)));
    // Marked first, so two saves at once can never take the stock out twice…
    // ("issuedMoves": its stock went out as entries linked to it — what comes back is counted from those alone.)
    const marked = await this.backend.update('dispatches', { ...dc, stockIssued: true, issuedMoves: true });
    this.put('dispatches', marked);
    const made: Rec[] = [];
    try {
      for (const [productId, qty] of lines) {
        // From the challan's warehouse; with none named, from wherever the stock is (no place below zero).
        const parts = dc.warehouseId ? [{ warehouseId: String(dc.warehouseId), qty }] : (this.takeFrom(productId, qty) || [{ warehouseId: '', qty }]);
        const rate = this.stockValuation(productId).avg;
        for (const part of parts) {
          made.push(await this.create('stockMoves', {
            productId, direction: 'Out', qty: part.qty, date: String(dc.date || todayIso()), projectId: dc.projectId, rate,
            warehouseId: part.warehouseId, reason: 'Delivery to site', sourceType: 'dispatches', sourceId: dc.id, reference: `DC ${dc.number || ''}`.trim(),
          }));
        }
      }
    } catch (e) {
      // …and if any entry fails, the whole issue is undone: entries removed, challan back to how it was.
      for (const m of made) { try { await this.backend.remove('stockMoves', m.id); } catch { /* left for the admin */ } }
      this.data = { ...this.data, stockMoves: this.all('stockMoves').filter((m) => !made.some((x) => x.id === m.id)) };
      const now = this.get('dispatches', id)!;
      try { this.put('dispatches', await this.backend.update('dispatches', { ...now, stockIssued: false, status: statusBefore })); } catch { /* reported below */ }
      this.emit();
      throw e;
    }
    if (lines.length) this.onWarning(`Took ${lines.length} item(s) on ${dc.number} out of stock.`);
  }

  /** Per product: issued with a challan and not yet returned — from its real stock entries. */
  outstandingOn(dc: Rec): Map<string, number> {
    const moves = this.movesFrom(dc.id);
    const out = new Map<string, number>();
    if (moves.length) {
      for (const m of moves) out.set(String(m.productId), round2((out.get(String(m.productId)) || 0) + (m.direction === 'Out' ? 1 : -1) * (Number(m.qty) || 0)));
    } else if (dc.stockIssued && !dc.issuedMoves) {
      // Challans issued by older versions: their lines, less what was returned since. (A challan issued now with no
      // entries had only services or no-stock items: nothing to bring back, even if a product keeps stock later.)
      const back = (dc.returned && typeof dc.returned === 'object' ? dc.returned : {}) as Record<string, number>;
      for (const [pid, q] of qtyByProduct(dc.items)) if (tracksStock(this.get('products', pid))) out.set(pid, round2(q - (Number(back[pid]) || 0)));
    }
    return new Map([...out].filter(([, q]) => q > 0.0001));
  }

  private async putBack(dc: Rec, qtys: Map<string, number>, date: string, reference: string) {
    const issued = this.movesFrom(dc.id).filter((m) => m.direction === 'Out');
    const back = { ...((dc.returned && typeof dc.returned === 'object' ? dc.returned : {}) as Record<string, number>) };
    for (const [productId, qty] of qtys) {
      const rate = issued.find((m) => m.productId === productId)?.rate;
      // Back to where it left from: each warehouse gets at most what left it on this challan (less earlier returns).
      const out = new Map<string, number>();
      for (const m of this.movesFrom(dc.id).filter((x) => x.productId === productId)) {
        const wh = String(m.warehouseId || '');
        out.set(wh, round2((out.get(wh) || 0) + (m.direction === 'Out' ? 1 : -1) * (Number(m.qty) || 0)));
      }
      const parts: [string, number][] = [];
      let left = qty;
      for (const [wh, q] of out) {
        const take = round2(Math.min(q, left));
        if (take > 0.0001) { parts.push([wh, take]); left = round2(left - take); }
      }
      if (left > 0.0001) parts.push([String(dc.warehouseId || ''), left]); // challans from older versions have no entries
      for (const [warehouseId, q] of parts) {
        await this.create('stockMoves', {
          productId, direction: 'In', qty: q, date, projectId: dc.projectId, rate: rate ?? this.stockValuation(productId).avg,
          warehouseId, reason: 'Return from site', sourceType: 'dispatches', sourceId: dc.id, reference,
        });
      }
      back[productId] = round2((Number(back[productId]) || 0) + qty);
    }
    return back;
  }

  private async returnDispatch(id: string) {
    const dc = this.get('dispatches', id)!;
    const lines = this.outstandingOn(dc);
    // Stock goes back first; the challan is marked only once all of it is back, so a failed return can be repeated
    // (what came back is counted from the entries) and "Return from site" keeps working meanwhile.
    const back = await this.putBack(dc, lines, todayIso(), `Return of DC ${dc.number || ''}`.trim());
    const now = this.get('dispatches', id)!;
    this.put('dispatches', await this.backend.update('dispatches', { ...now, stockIssued: false, returned: back }));
    if (lines.size) this.onWarning(`Put ${lines.size} item(s) from ${dc.number} back into stock.`);
  }

  /** Some material came back from site: never more than went out with this challan less earlier returns. */
  async returnFromSite(dcId: string, qtys: Record<string, number>, date = todayIso()): Promise<void> {
    const dc = this.get('dispatches', dcId);
    if (!dc) throw new AppError('Challan not found');
    if (!dc.stockIssued) throw new AppError('Nothing went out of stock with this challan yet.');
    if (dc.date && date < String(dc.date)) throw new AppError(`Material cannot come back before it left: the challan is dated ${formatDate(String(dc.date))}.`);
    const dcEntity = getEntity('dispatches')!;
    this.checkPermission(dcEntity, dc);
    const open = this.outstandingOn(dc);
    const lines = new Map<string, number>();
    for (const [pid, raw] of Object.entries(qtys)) {
      const q = round2(Number(raw) || 0);
      if (q <= 0) continue;
      const max = open.get(pid) || 0;
      if (q > max + 0.0001) throw new AppError(`${this.titleOf('products', pid)}: only ${max} can come back on this challan.`);
      lines.set(pid, q);
    }
    if (!lines.size) throw new AppError('Enter how much came back.');
    const back = await this.putBack(dc, lines, date, `Return from site, DC ${dc.number || ''}`.trim());
    const now = this.get('dispatches', dcId)!;
    this.put('dispatches', await this.backend.update('dispatches', { ...now, returned: back }));
    await this.logActivity('dispatches', dcId, { kind: 'note', text: `Returned from site: ${[...lines].map(([p, q]) => `${q} × ${this.titleOf('products', p)}`).join(', ')}` });
    this.emit();
  }

  /** Moves stock between warehouses as one pair of linked entries. */
  async transferStock(productId: string, qty: number, from: string, to: string, opts: { date?: string; note?: string } = {}): Promise<void> {
    const q = round2(Number(qty) || 0);
    if (!(q > 0)) throw new AppError('Enter a quantity more than 0.');
    if (from === to) throw new AppError('Choose two different places.');
    if (!to) throw new AppError('Choose the warehouse the stock goes to.');
    const have = this.stockIn(productId, from);
    if (have < q) throw new AppError(`Only ${have} there to move.`);
    const sourceId = uid();
    const rate = this.stockValuation(productId).avg;
    const ref = `Transfer ${from ? this.titleOf('warehouses', from) : 'unassigned stock'} → ${this.titleOf('warehouses', to)}${opts.note ? ` (${opts.note})` : ''}`;
    const base = { productId, qty: q, date: opts.date || todayIso(), rate, reason: 'Transfer', sourceType: 'transfer', sourceId, reference: ref };
    const out = await this.create('stockMoves', { ...base, direction: 'Out', warehouseId: from });
    try { await this.create('stockMoves', { ...base, direction: 'In', warehouseId: to }); }
    catch (e) {
      // Never leave half a transfer: take the first half back out of the books.
      await this.backend.remove('stockMoves', out.id).catch(() => {});
      this.data = { ...this.data, stockMoves: this.all('stockMoves').filter((r) => r.id !== out.id) };
      this.emit();
      throw e;
    }
  }

  /** A stock count: books the difference between what was counted and what the books say. */
  async adjustStock(productId: string, counted: number, opts: { warehouseId?: string; reason?: string; date?: string; note?: string } = {}): Promise<number> {
    const c = round2(Number(counted));
    if (!Number.isFinite(c) || c < 0) throw new AppError('Enter the quantity you counted (0 or more).');
    const wh = opts.warehouseId || '';
    const booked = wh ? round2(this.stockByWarehouse(productId).find((x) => x.warehouseId === wh)?.qty || 0) : this.stockOf(productId);
    const diff = round2(c - booked);
    if (Math.abs(diff) < 0.0001) return 0;
    // Counting "everywhere" and finding less: taken from the places that have it, so no place goes below zero.
    const parts = diff < 0 && !wh ? (this.takeFrom(productId, -diff) || [{ warehouseId: '', qty: -diff }]) : [{ warehouseId: wh, qty: Math.abs(diff) }];
    const rate = this.stockValuation(productId).avg;
    for (const part of parts) {
      await this.create('stockMoves', {
        productId, direction: diff > 0 ? 'In' : 'Out', qty: part.qty, date: opts.date || todayIso(), warehouseId: part.warehouseId,
        rate, reason: opts.reason || 'Count correction',
        reference: `Stock count: ${booked} → ${c}${opts.note ? ` (${opts.note})` : ''}`,
      });
    }
    return diff;
  }

  /** Creates (or links to an existing) customer from a lead. Returns the customer. */
  async convertLead(leadId: string): Promise<Rec> {
    const lead = this.get('leads', leadId);
    if (!lead) throw new AppError('Lead not found');
    const existingCustomer = lead.customerId ? this.get('customers', lead.customerId) : undefined;
    if (existingCustomer) return existingCustomer;
    const customers = getEntity('customers')!;
    const dup = this.findDuplicates(customers, { phone: lead.phone, email: lead.email });
    // Everything the lead knows comes along — state and PIN code too, which decide CGST + SGST or IGST.
    const customer = dup ? dup.matches[0] : await this.create('customers', {
      name: lead.name, phone: lead.phone, ...(lead.whatsapp ? { whatsapp: lead.whatsapp } : {}), email: lead.email || '', city: lead.city || '', address: lead.address || '',
      state: lead.state || '', pincode: lead.pincode || '', segment: lead.segment || 'Residential', lifecycle: 'Prospect',
    }, { allowDuplicate: true });
    const fresh = this.get('leads', leadId)!;
    const saved = await this.backend.update('leads', { ...fresh, customerId: customer.id });
    this.put('leads', saved);
    this.emit();
    return customer;
  }

  /**
   * The customer said yes: the quotation becomes the order. Marks it Accepted, the lead Won (with a customer),
   * the customer an active project, and — unless one is linked already — starts the installation project.
   */
  async confirmQuotation(quoteId: string, opts: { createProject?: boolean } = {}): Promise<{ quote: Rec; project?: Rec }> {
    const q = this.get('quotations', quoteId);
    if (!q) throw new AppError('Quotation not found');
    if (['Rejected', 'Expired'].includes(String(q.status))) throw new AppError(`This quotation is ${String(q.status).toLowerCase()}. Set it back to Sent first, or make a new one.`);
    const customer = this.get('customers', q.customerId);
    if (!customer) throw new AppError('The customer on this quotation no longer exists.');
    let quote = q.status === 'Accepted' ? q : await this.update('quotations', q.id, { status: 'Accepted' }, { allowDuplicate: true });
    const lead = q.leadId ? this.get('leads', q.leadId) : undefined;
    if (lead && lead.status !== 'Won') {
      try { await this.update('leads', lead.id, { status: 'Won', ...(lead.customerId ? {} : { customerId: customer.id }) }, { allowDuplicate: true }); }
      catch (e) { this.warn('Order confirmed, but the lead could not be marked Won', e); }
    }
    if (['Prospect', 'Inactive', '', undefined].includes(customer.lifecycle as string)) {
      try { await this.update('customers', customer.id, { lifecycle: 'Active Project' }, { allowDuplicate: true }); }
      catch (e) { this.warn('Order confirmed, but the customer could not be updated', e); }
    }
    let project = q.projectId ? this.get('projects', q.projectId) : undefined;
    if (!project && opts.createProject !== false && this.user && canWrite(this.user, 'projects')) {
      const kw = Number(q.systemKw) || 0;
      project = await this.create('projects', {
        name: `${customer.name}${kw ? ` — ${kw} kW` : ''}`.slice(0, 120), customerId: customer.id, capacityKw: kw || '',
        stage: 'Planning', startDate: todayIso(), budget: this.totalsFor('quotations', q).grandTotal,
        notes: `From quotation ${q.number || ''}`.trim(),
      }, { allowDuplicate: true });
      quote = await this.update('quotations', q.id, { projectId: project.id }, { allowDuplicate: true });
    }
    return { quote, project };
  }

  async quotationToInvoice(quoteId: string): Promise<Rec> {
    const q = this.get('quotations', quoteId);
    if (!q) throw new AppError('Quotation not found');
    // A cancelled invoice frees the quotation, so it can be invoiced again.
    const already = q.invoiceId ? this.get('invoices', q.invoiceId) : undefined;
    if (already && already.status !== 'Cancelled') throw new AppError(`This quotation was already converted to ${already.number}.`);
    if (['Rejected', 'Expired'].includes(String(q.status))) throw new AppError(`This quotation is ${String(q.status).toLowerCase()}, so it cannot be invoiced. Set it back to Sent first, or make a new one.`);
    if (!this.get('customers', q.customerId)) throw new AppError('The customer on this quotation no longer exists.');
    // Invoicing means the customer said yes: confirm the order first (lead Won, customer an active project).
    if (q.status !== 'Accepted') {
      try { await this.confirmQuotation(q.id, { createProject: false }); }
      catch (e) { this.warn('Invoice made, but the order could not be confirmed (lead and customer not updated)', e); }
    }
    const inv = await this.create('invoices', {
      customerId: q.customerId, ...(q.projectId && this.get('projects', q.projectId) ? { projectId: q.projectId } : {}),
      date: todayIso(), items: q.items, discount: q.discount || 0, placeOfSupply: q.placeOfSupply || '',
      status: 'Draft', notes: `From quotation ${q.number || ''}`.trim(),
    });
    try {
      await this.update('quotations', q.id, { invoiceId: inv.id, status: 'Accepted' }, { allowDuplicate: true });
    } catch (e) {
      this.warn(`${inv.number ? `Invoice ${inv.number}` : 'Draft invoice'} created, but the quotation could not be updated`, e);
    }
    return inv;
  }

  // ---------------------------------------------------------------- activity log
  // Every record keeps its own history — who created it, what changed (old → new) and notes from the team —
  // stored as "activity" records next to the data, so it travels with backups and is shared in cloud mode.

  /** What changed in words, field by field, e.g. Status: Draft → Sent. Internal fields are left out. */
  describeChanges(entity: Entity, before: Rec, after: Rec): ActivityChange[] {
    const out: ActivityChange[] = [];
    for (const f of entity.fields) {
      if (f.hidden) continue;
      const a = before[f.key], b = after[f.key];
      if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
      if ((a === undefined || a === null || a === '') && (b === undefined || b === null || b === '')) continue;
      if (f.type === 'items') {
        const t0 = this.totalsFor(entity.key, before).grandTotal, t1 = this.totalsFor(entity.key, after).grandTotal;
        const n0 = Array.isArray(a) ? a.length : 0, n1 = Array.isArray(b) ? b.length : 0;
        out.push({ field: f.key, label: f.label, from: `${n0} line(s), ₹${t0.toLocaleString('en-IN')}`, to: `${n1} line(s), ₹${t1.toLocaleString('en-IN')}` });
        continue;
      }
      out.push({ field: f.key, label: f.label, from: this.shown(f, a), to: this.shown(f, b) });
    }
    return out;
  }

  private shown(f: Entity['fields'][number], v: unknown): string {
    if (v === undefined || v === null || v === '') return '—';
    switch (f.type) {
      case 'ref': return this.titleOf(f.ref!, v);
      case 'user': return this.userName(v);
      case 'money': return `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
      case 'bool': return v ? 'Yes' : 'No';
      case 'checklist': return Array.isArray(v) ? `${v.length} of ${f.items?.length || v.length} done` : '—';
      case 'file': return (v as { name?: string }).name || 'file';
      case 'date': return formatDate(String(v));
      case 'datetime': return formatDate(String(v).slice(0, 10)) + (String(v).length > 10 ? ` ${String(v).slice(11, 16)}` : '');
      default: { const s = String(v); return s.length > 80 ? s.slice(0, 77) + '…' : s; }
    }
  }

  /** Adds a line to a record's history. A history entry that fails to save never undoes the change itself. */
  private async logActivity(entityKey: string, recordId: string, entry: { kind: ActivityKind; text?: string; changes?: ActivityChange[] }) {
    if (entityKey === ACTIVITY || entityKey === SETTINGS) return;
    const now = new Date().toISOString();
    const rec = { id: uid(), createdAt: now, updatedAt: now, createdBy: this.user?.id, on: entityKey, recordId, ...entry } as Rec;
    try { this.put(ACTIVITY, await this.backend.insert(ACTIVITY, rec)); }
    catch { /* history is a convenience; the record itself is already saved */ }
  }

  /** A note from the team on a record (anyone who can see the record may add one). */
  async addNote(entityKey: string, recordId: string, text: string): Promise<void> {
    const e = getEntity(entityKey);
    const clean = text.trim();
    if (!e || !this.get(entityKey, recordId)) throw new AppError('This record no longer exists.');
    if (!this.user || !canRead(this.user, e.module)) throw new AppError('You cannot add notes here.');
    if (!clean) throw new AppError('Write a note first.');
    if (clean.length > 4000) throw new AppError('Notes can be up to 4,000 characters.');
    const now = new Date().toISOString();
    const rec = { id: uid(), createdAt: now, updatedAt: now, createdBy: this.user.id, on: entityKey, recordId, kind: 'note', text: clean } as Rec;
    this.put(ACTIVITY, await this.backend.insert(ACTIVITY, rec));
    this.emit();
  }

  /** A record's history, newest first. */
  activityFor(entityKey: string, recordId: string): Rec[] {
    // Same-moment entries keep the order they were saved in (ids are random, so they can't break ties).
    return (this.data[ACTIVITY] || []).map((a, i) => ({ a, i })).filter(({ a }) => a.on === entityKey && a.recordId === recordId)
      .sort((x, y) => y.a.createdAt.localeCompare(x.a.createdAt) || y.i - x.i).map(({ a }) => a);
  }

  /** Cloud records are upgraded as they are read; device mode upgrades the stored data once at start. */
  private async loadData(): Promise<DataMap> {
    const loaded = await this.backend.loadAll();
    return this.backend.mode === 'cloud' ? migrate(loaded, 1) : loaded;
  }

  async replaceAll(data: DataMap, opts?: ReplaceOptions) {
    if (this.user && !isAdmin(this.user)) throw new AppError('Only the admin can restore a backup or load demo data.');
    this.checkWritable();
    await this.backend.replaceAll(data, opts);
    await this.load();
  }

  exportAll(): DataMap {
    return JSON.parse(JSON.stringify(this.data));
  }
}
