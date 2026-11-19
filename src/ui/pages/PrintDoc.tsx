import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import { getEntity } from '../../modules/registry';
import type { Entity, LineItem, Rec } from '../../lib/schema';
import { useStore, type CompanySettings, type FileRef, type Store } from '../../lib/store';
import { amountInWords, emiSchedule, hsnSummary, lineAmount, money, round2, solarEstimate, computeEmi, computeTotals } from '../../lib/money';
import { stateWithCode } from '../../lib/states';
import { formatDate, localDateOf, todayIso } from '../../lib/format';
import { WhatsAppButton } from '../components/WhatsApp';
import { waDisplay, waNumber } from '../../lib/whatsapp';
import { BRAND } from '../../config/brand';
import { FieldValue } from '../components/FieldValue';
import { Icon } from '../components/Icon';
import { NotFound } from './NotFound';

export const DOC_TITLES: Record<string, string> = {
  quotations: 'Quotation', invoices: 'Tax Invoice', purchaseOrders: 'Purchase Order', payments: 'Payment Receipt',
  installations: 'Installation & Commissioning Certificate', surveys: 'Site Survey Report', tickets: 'Service Report',
  amcs: 'Annual Maintenance Contract', dispatches: 'Delivery Challan', customers: 'Statement of Account',
  expenses: 'Expense Voucher', projects: 'Project Summary', loans: 'Loan Summary & EMI Schedule',
};

const COPIES: Record<string, string[]> = {
  invoices: ['Original for Recipient', 'Duplicate for Transporter', 'Triplicate for Supplier'],
  // Delivery challans (CGST Rules, rule 55): three copies.
  dispatches: ['Original for Consignee', 'Duplicate for Transporter', 'Triplicate for Consigner'],
};

/** A UPI ID looks like name@bank. Anything else is never put in a payment QR code. */
export function isValidUpiId(v: string): boolean {
  return /^[\w.-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/.test(v.trim());
}

export function upiLink(upiId: string, payee: string, amount: number, note: string): string {
  const p = new URLSearchParams({ pa: upiId.trim(), pn: payee.slice(0, 50), am: round2(amount).toFixed(2), cu: 'INR', tn: note.slice(0, 50) });
  return `upi://pay?${p.toString()}`;
}

function QrCode({ text, size = 120, label }: { text: string; size?: number; label: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
  }, [text]);
  // The SVG is produced by the QR library from our own text, never from user HTML.
  return <div className="qr" role="img" aria-label={label} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Safe image address for a stored file (data: image on this device, signed https link in the cloud), or "" while loading. */
export function useFileUrl(store: Store, ref: FileRef | null | undefined): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    setUrl('');
    if (ref && typeof ref === 'object' && /^image\//.test(String(ref.type || '')) ) {
      store.backend.fileUrl(ref).then((u) => { if (live && (/^data:image\//.test(u) || /^https:\/\//.test(u))) setUrl(u); }).catch(() => {});
    }
    return () => { live = false; };
  }, [store, ref]);
  return url;
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

function partyFor(store: Store, key: string, rec: Rec): { label: string; party?: Rec } {
  if (key === 'purchaseOrders') return { label: 'Vendor', party: store.get('vendors', rec.vendorId) };
  if (key === 'customers') return { label: 'Customer', party: rec };
  if (key === 'payments') return { label: 'Received from', party: store.get('customers', store.get('invoices', rec.invoiceId)?.customerId) };
  if (key === 'installations' || key === 'projects') {
    const pr = key === 'projects' ? rec : store.get('projects', rec.projectId);
    return { label: 'Customer', party: store.get('customers', pr?.customerId) };
  }
  if (key === 'surveys') return { label: 'Customer', party: store.get('leads', rec.leadId) };
  if (key === 'dispatches') return { label: 'Deliver to', party: store.get('customers', rec.customerId) };
  if (key === 'expenses') return { label: 'Paid for', party: undefined };
  return { label: key === 'quotations' ? 'Quotation for' : 'Bill to', party: store.get('customers', rec.customerId) };
}

function docDate(key: string, rec: Rec): string {
  return str(rec.date || rec.scheduledDate || rec.surveyDate || rec.startDate || (key === 'customers' ? todayIso() : '') || localDateOf(rec.createdAt));
}

export function PrintDoc() {
  const { entity: key = '', id = '' } = useParams();
  const store = useStore();
  const entity = getEntity(key);
  const rec = store.get(key, id);
  if (!entity || !rec || !entity.printable) return <NotFound />;
  return <PrintInner key={`${key}/${id}`} entity={entity} rec={rec} />;
}

function PrintInner({ entity, rec }: { entity: Entity; rec: Rec }) {
  const store = useStore();
  const key = entity.key;
  const s = store.settings();
  const company = s.companyName || BRAND.name;
  const copies = COPIES[key];
  const [copy, setCopy] = useState(copies?.[0] || '');
  const logo = useFileUrl(store, s.logo);
  const sign = useFileUrl(store, s.signature);
  const { label: partyLabel, party } = partyFor(store, key, rec);
  // Without a GSTIN the business is not registered for GST, so its bill is not a "tax invoice".
  const title = key === 'invoices' && !s.gstin ? 'Invoice' : DOC_TITLES[key] || entity.label;
  const draft = key === 'invoices' && rec.status === 'Draft';
  const number = str(rec.number);

  // The browser uses the page title as the PDF file name.
  useEffect(() => {
    const before = document.title;
    const who = party ? str(party.name) : '';
    document.title = [title, number, who].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '-');
    return () => { document.title = before; };
  }, [title, number, party]);

  const accent = /^#[0-9a-f]{6}$/i.test(s.accentColor) ? s.accentColor : '#0f6b5c';
  const style = { '--doc-accent': accent } as CSSProperties;

  return (
    <>
      <div className="page-head no-print">
        <Link to={key === 'customers' ? `/m/customers/${rec.id}` : `/m/${key}/${rec.id}`} className="btn">← Back</Link>
        <div className="spacer" />
        {!s.companyName && <span className="muted small">Tip: add your company details in Settings → General, and your logo in Settings → Documents & print.</span>}
        {key === 'invoices' && !s.gstin && <span className="banner warn small">Add your company GSTIN in Settings → General to print tax invoices.</span>}
        {draft && <span className="banner warn small">This invoice is still a Draft: set it to Sent before giving it to the customer.</span>}
        {copies && (
          <select className="input" style={{ width: 'auto' }} aria-label="Copy" value={copy} onChange={(e) => setCopy(e.target.value)}>
            {copies.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
        <WhatsAppButton entity={key} rec={rec} print />
        <button className="btn primary" onClick={() => window.print()}><Icon name="print" size={16} />Print / Save as PDF</button>
      </div>
      <div className={`doc tpl-${s.printTemplate || 'classic'}`} style={style}>
        <header className="doc-head">
          <div className="doc-company">
            {logo && <img className="doc-logo" src={logo} alt={`${company} logo`} />}
            <div>
              <div className="doc-co">{company}</div>
              {s.tagline && <div className="doc-tag">{s.tagline}</div>}
              <div className="pre">{s.address}</div>
              <div>{[s.phone, s.whatsapp && waNumber(s.whatsapp) !== waNumber(s.phone) ? `WhatsApp ${waDisplay(String(waNumber(s.whatsapp)))}` : '', s.email, s.website].filter(Boolean).join(' · ')}</div>
              {s.gstin && <div>GSTIN: <strong>{s.gstin}</strong>{s.pan ? ` · PAN: ${s.pan}` : ''}{store.companyState() ? ` · State: ${stateWithCode(store.companyState())}` : ''}</div>}
            </div>
          </div>
          <div className="doc-meta">
            <h1 className="doc-title">{title}</h1>
            {copies && !draft && <div className="doc-copy">{copy}</div>}
            {draft && <div className="doc-cancel">DRAFT — not a valid tax invoice</div>}
            {number && <div>No: <strong>{number}</strong></div>}
            <div>Date: {formatDate(docDate(key, rec))}</div>
            {!!rec.dueDate && key !== 'tickets' && <div>Due: {formatDate(rec.dueDate)}</div>}
            {!!rec.validTill && <div>Valid till: {formatDate(rec.validTill)}</div>}
            {!!rec.expectedDate && <div>Delivery by: {formatDate(rec.expectedDate)}</div>}
            {rec.status === 'Cancelled' && <div className="doc-cancel">CANCELLED</div>}
            {key === 'installations' && rec.status !== 'Completed' && <div className="doc-cancel">PROVISIONAL — work not yet completed</div>}
          </div>
        </header>

        {key !== 'expenses' && (
          <section className="doc-parties">
            <div>
              <div className="doc-label">{partyLabel}</div>
              {party ? <>
                <strong>{str(party.name)}</strong>
                {!!party.contactPerson && <div>Attn: {str(party.contactPerson)}</div>}
                <div className="pre">{str(party.address)}</div>
                <div>{[party.city, party.state ? stateWithCode(party.state) : '', party.pincode].filter(Boolean).map(String).join(', ')}</div>
                <div>{[party.phone, party.email].filter(Boolean).map(String).join(' · ')}</div>
                {!!party.gstin && <div>GSTIN: {str(party.gstin)}</div>}
                {!!party.consumerNo && <div>Consumer no.: {str(party.consumerNo)}</div>}
              </> : <div>—</div>}
            </div>
            <div><DocRefs store={store} k={key} rec={rec} s={s} /></div>
          </section>
        )}

        <DocBody store={store} entity={entity} rec={rec} s={s} company={company} />

        <DocTerms k={key} rec={rec} s={s} />

        <footer className="doc-sign">
          <div>{({ installations: 'Customer signature', tickets: 'Customer signature', dispatches: 'Received by (name, sign, date)', amcs: 'Customer signature', surveys: 'Customer signature' } as Record<string, string>)[key] || 'Receiver’s signature'}</div>
          <div className="right">
            For <strong>{company}</strong>
            {sign ? <img className="doc-signature" src={sign} alt="Authorised signature" /> : <div style={{ height: 44 }} />}
            Authorised signatory
          </div>
        </footer>
        {s.footerNote && <div className="doc-foot">{s.footerNote}</div>}
      </div>
    </>
  );
}


function DocRefs({ store, k, rec, s }: { store: Store; k: string; rec: Rec; s: CompanySettings }) {
  const rows: [string, ReactNode][] = [];
  // Place of supply: as entered, else the customer's state (with its GST state code).
  const pos = str(rec.placeOfSupply) || (['invoices', 'quotations', 'dispatches'].includes(k) ? str(store.get('customers', rec.customerId)?.state || store.get('customers', store.get('projects', rec.projectId)?.customerId)?.state) : '');
  if (pos) rows.push(['Place of supply', stateWithCode(pos)]);
  if (k === 'invoices' || k === 'quotations') rows.push(['Tax', rec.interState ? 'IGST (inter-state)' : 'CGST + SGST (intra-state)']);
  if (k === 'invoices') rows.push(['Reverse charge', 'No']);
  if (rec.systemKw) rows.push(['System size', `${str(rec.systemKw)} kW`]);
  const project = store.get('projects', rec.projectId);
  if (project) rows.push(['Project', `${str(project.name)}${project.capacityKw ? ` · ${project.capacityKw} kW` : ''}`]);
  if (k === 'payments') rows.push(['Against invoice', str(store.get('invoices', rec.invoiceId)?.number || '—')]);
  if (k === 'dispatches') {
    if (rec.vehicleNo) rows.push(['Vehicle', str(rec.vehicleNo)]);
    if (rec.transporter) rows.push(['Transporter', str(rec.transporter)]);
    const wh = store.get('warehouses', rec.warehouseId);
    if (wh) rows.push(['From', `${str(wh.name)}${wh.location ? `, ${wh.location}` : ''}`]);
  }
  if (k === 'purchaseOrders') rows.push(['Ship to', <span className="pre" key="st">{s.companyName}{s.address ? `\n${s.address}` : ''}</span>]);
  if (k === 'tickets') {
    rows.push(['Type', str(rec.type)], ['Priority', str(rec.priority)], ['Status', str(rec.status)]);
    if (rec.assignedTo) rows.push(['Engineer', store.userName(rec.assignedTo)]);
  }
  if (k === 'surveys' && rec.surveyor) rows.push(['Surveyor', store.userName(rec.surveyor)]);
  if (k === 'installations' && rec.technician) rows.push(['Lead technician', store.userName(rec.technician)]);
  if (k === 'loans') rows.push(['Lender', str(rec.bank)], ['Status', str(rec.status)]);
  if (k === 'customers') rows.push(['Statement date', formatDate(todayIso())]);
  if (!rows.length) return null;
  return <table className="doc-kv"><tbody>{rows.map(([a, b]) => <tr key={a}><th>{a}</th><td>{b}</td></tr>)}</tbody></table>;
}

function ItemsBlock({ store, k, rec, priced = true }: { store: Store; k: string; rec: Rec; priced?: boolean }) {
  const items = (Array.isArray(rec.items) ? (rec.items as LineItem[]) : []).filter((it) => it && typeof it === 'object');
  const t = store.totalsFor(k, rec);
  const anyDisc = items.some((it) => Number(it.discountPct) > 0);
  return (
    <>
      <table className="doc-items">
        <thead>
          <tr>
            <th>#</th><th>Description</th><th>HSN/SAC</th><th className="num">Qty</th><th>Unit</th>
            {priced && <><th className="num">Rate</th>{anyDisc && <th className="num">Disc %</th>}<th className="num">GST %</th><th className="num">Amount</th></>}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td>{i + 1}</td><td>{it.description}</td><td>{it.hsn || ''}</td><td className="num">{it.qty}</td><td>{it.unit || ''}</td>
              {priced && <><td className="num">{money(it.rate)}</td>{anyDisc && <td className="num">{Number(it.discountPct) || 0}%</td>}<td className="num">{it.gstRate}%</td><td className="num">{money(lineAmount(it))}</td></>}
            </tr>
          ))}
          {!items.length && <tr><td colSpan={9} className="muted">No items</td></tr>}
        </tbody>
      </table>
      {priced && (
        <div className="doc-totals-row">
          <div className="doc-words"><strong>Amount in words:</strong><br />{amountInWords(t.grandTotal)}</div>
          <table className="doc-totals">
            <tbody>
              {t.lineDiscount > 0 && <tr><th>Gross amount</th><td>{money(t.gross)}</td></tr>}
              {t.lineDiscount > 0 && <tr><th>Line discounts</th><td>− {money(t.lineDiscount)}</td></tr>}
              <tr><th>Subtotal</th><td>{money(t.subtotal)}</td></tr>
              {t.discount > 0 && <tr><th>Discount</th><td>− {money(t.discount)}</td></tr>}
              <tr><th>Taxable value</th><td>{money(t.taxable)}</td></tr>
              {t.igst > 0 || rec.interState ? <tr><th>IGST</th><td>{money(t.igst)}</td></tr> : <>
                <tr><th>CGST</th><td>{money(t.cgst)}</td></tr>
                <tr><th>SGST</th><td>{money(t.sgst)}</td></tr>
              </>}
              {t.roundOff !== 0 && <tr><th>Round off</th><td>{t.roundOff > 0 ? '+' : '−'} {money(Math.abs(t.roundOff))}</td></tr>}
              <tr className="grand"><th>Total</th><td>{money(t.grandTotal)}</td></tr>
              {k === 'invoices' && <>
                <tr><th>Received</th><td>{money(store.paidOn(rec.id))}</td></tr>
                <tr className="grand"><th>Balance due</th><td>{money(store.computed('invoices', rec).balance)}</td></tr>
              </>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Delivery challan lines with value and tax (CGST Rules, rule 55): the line's rate, else the product's sale price. */
function ChallanItems({ store, rec }: { store: Store; rec: Rec }) {
  const items = (Array.isArray(rec.items) ? (rec.items as LineItem[]) : []).filter((it) => it && typeof it === 'object')
    .map((it) => ({ ...it, rate: Number(it.rate) > 0 ? Number(it.rate) : Number(store.get('products', it.productId)?.price) || 0 }));
  const pr = store.get('projects', rec.projectId);
  // The tax type the challan was saved with (a later change to the customer's state does not change a reprint).
  const inter = typeof rec.interState === 'boolean' ? rec.interState : store.interStateFor({ customerId: rec.customerId || pr?.customerId, placeOfSupply: rec.placeOfSupply });
  const t = computeTotals(items, 0, inter);
  const disc = items.some((it) => Number(it.discountPct) > 0);
  return <>
    <table className="doc-items">
      <thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate</th>{disc && <th className="num">Disc %</th>}<th className="num">Taxable value</th><th className="num">GST %</th><th className="num">Tax</th></tr></thead>
      <tbody>
        {items.map((it, i) => {
          const v = lineAmount(it);
          return <tr key={i}><td>{i + 1}</td><td>{it.description}</td><td>{it.hsn || ''}</td><td className="num">{it.qty}</td><td>{it.unit || ''}</td>
            <td className="num">{money(it.rate)}</td>{disc && <td className="num">{Number(it.discountPct) || 0}%</td>}<td className="num">{money(v)}</td><td className="num">{it.gstRate}%</td><td className="num">{money(round2(v * (Number(it.gstRate) || 0) / 100))}</td></tr>;
        })}
        {!items.length && <tr><td colSpan={disc ? 10 : 9} className="muted">No items</td></tr>}
      </tbody>
    </table>
    <div className="doc-totals-row">
      <div className="doc-words small">Goods sent for supply to the consignee, valued at the agreed price{disc ? ' after line discounts' : ''}; the tax invoice follows.</div>
      <table className="doc-totals"><tbody>
        <tr><th>Taxable value</th><td>{money(t.taxable)}</td></tr>
        {inter ? <tr><th>IGST</th><td>{money(t.igst)}</td></tr> : <><tr><th>CGST</th><td>{money(t.cgst)}</td></tr><tr><th>SGST</th><td>{money(t.sgst)}</td></tr></>}
        {Math.abs(t.roundOff) > 0.001 && <tr><th>Round off</th><td>{money(t.roundOff)}</td></tr>}
        <tr className="grand"><th>Value of goods</th><td>{money(t.grandTotal)}</td></tr>
      </tbody></table>
    </div>
  </>;
}

function HsnTable({ store, rec }: { store: Store; rec: Rec }) {
  const items = (rec.items as LineItem[]) || [];
  const inter = store.totalsFor('invoices', rec).igst > 0 || rec.interState === true;
  // Rows add up exactly to the invoice totals above.
  const rows = hsnSummary(items, Number(rec.discount) || 0, inter);
  if (!rows.length) return null;
  const pct = (n: number) => `${Math.round(n * 100) / 100}%`;
  return (
    <table className="doc-hsn">
      <thead><tr><th>HSN/SAC</th><th className="num">Taxable value</th>
        {inter ? <><th className="num">IGST rate</th><th className="num">IGST</th></> : <><th className="num">CGST rate</th><th className="num">CGST</th><th className="num">SGST rate</th><th className="num">SGST</th></>}
        <th className="num">Total tax</th></tr></thead>
      <tbody>
        {rows.map((h) => (
          <tr key={h.hsn + h.gstRate}>
            <td>{h.hsn}</td><td className="num">{money(h.taxable)}</td>
            {inter ? <><td className="num">{pct(h.gstRate)}</td><td className="num">{money(h.igst)}</td></>
              : <><td className="num">{pct(h.gstRate / 2)}</td><td className="num">{money(h.cgst)}</td><td className="num">{pct(h.gstRate / 2)}</td><td className="num">{money(h.sgst)}</td></>}
            <td className="num">{money(h.tax)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BankAndQr({ store, rec, s, company }: { store: Store; rec: Rec; s: CompanySettings; company: string }) {
  const balance = store.computed('invoices', rec).balance;
  const showQr = s.showUpiQr && isValidUpiId(s.upiId) && balance > 0 && rec.status !== 'Cancelled' && rec.status !== 'Draft';
  if (!s.accountNo && !showQr) return null;
  return (
    <section className="doc-pay">
      {s.accountNo && (
        <div>
          <div className="doc-label">Bank details</div>
          <div>{s.companyName || company}</div>
          <div>{s.bankName}</div>
          <div>A/c no.: <strong>{s.accountNo}</strong></div>
          <div>IFSC: <strong>{s.ifsc}</strong></div>
          {s.upiId && <div>UPI: {s.upiId}</div>}
        </div>
      )}
      {showQr && (
        <div className="doc-qr">
          <QrCode text={upiLink(s.upiId, company, balance, rec.number ? `Invoice ${rec.number}` : 'Invoice payment')} label={`UPI payment QR for ${money(balance)}`} />
          <div className="small">Scan to pay {money(balance)}<br />with any UPI app</div>
        </div>
      )}
    </section>
  );
}

function FieldsTable({ entity, rec, skip = [] }: { entity: Entity; rec: Rec; skip?: string[] }) {
  const fields = entity.fields.filter((f) => !f.hidden && !['items', 'checklist', 'textarea', 'file'].includes(f.type) && !skip.includes(f.key) && rec[f.key] !== undefined && rec[f.key] !== '' && rec[f.key] !== null);
  return (
    <table className="doc-kv wide">
      <tbody>
        {fields.map((f) => <tr key={f.key}><th>{f.label}</th><td><FieldValue field={f} rec={rec} /></td></tr>)}
      </tbody>
    </table>
  );
}

function Checklist({ entity, rec }: { entity: Entity; rec: Rec }) {
  return <>{entity.fields.filter((f) => f.type === 'checklist').map((f) => {
    const done = Array.isArray(rec[f.key]) ? (rec[f.key] as string[]) : [];
    return (
      <div key={f.key} className="doc-block">
        <div className="doc-label">{f.label}</div>
        <ul className="doc-check">{f.items!.map((it) => <li key={it}><span className="box">{done.includes(it) ? '✓' : ''}</span>{it}</li>)}</ul>
      </div>
    );
  })}</>;
}

function Notes({ entity, rec }: { entity: Entity; rec: Rec }) {
  return <>{entity.fields.filter((f) => f.type === 'textarea' && !['address', 'terms'].includes(f.key) && rec[f.key]).map((f) => (
    <div key={f.key} className="doc-block"><div className="doc-label">{f.label}</div><div className="pre">{str(rec[f.key])}</div></div>
  ))}</>;
}

function Photo({ store, rec, k }: { store: Store; rec: Rec; k: string }) {
  const url = useFileUrl(store, rec[k] as FileRef | undefined);
  if (!url) return null;
  return <div className="doc-block"><img className="doc-photo" src={url} alt="Attached photo" /></div>;
}

function DocBody({ store, entity, rec, s, company }: { store: Store; entity: Entity; rec: Rec; s: CompanySettings; company: string }) {
  const k = entity.key;
  switch (k) {
    case 'quotations': {
      const total = store.computed('quotations', rec).grandTotal;
      const est = s.showSavingsOnQuote ? solarEstimate(Number(rec.systemKw), s.unitsPerKwPerDay, s.tariffPerUnit, total) : null;
      return <>
        <ItemsBlock store={store} k={k} rec={rec} />
        {est && (
          <section className="doc-estimate">
            <div><span>Estimated generation</span><strong>{est.units.toLocaleString('en-IN')} units / year</strong></div>
            {est.savings > 0 && <div><span>Estimated savings</span><strong>{money(est.savings)} / year</strong></div>}
            {est.payback && <div><span>Simple payback</span><strong>{est.payback} years</strong></div>}
            <p className="small">Estimate at {s.unitsPerKwPerDay} units per kW per day and ₹{s.tariffPerUnit}/unit. Actual generation depends on location, shading, weather and usage. Subsidy not included.</p>
          </section>
        )}
        {s.showBankOnQuote && s.accountNo && <p><strong>Bank details:</strong> {s.bankName} · A/c {s.accountNo} · IFSC {s.ifsc}</p>}
      </>;
    }
    case 'invoices':
      return <>
        <ItemsBlock store={store} k={k} rec={rec} />
        <HsnTable store={store} rec={rec} />
        <BankAndQr store={store} rec={rec} s={s} company={company} />
      </>;
    case 'purchaseOrders':
      return <ItemsBlock store={store} k={k} rec={rec} />;
    case 'dispatches':
      return <ChallanItems store={store} rec={rec} />;
    case 'payments': {
      const inv = store.get('invoices', rec.invoiceId);
      const who = str(store.get('customers', inv?.customerId)?.name) || '—';
      return <>
        <p className="doc-receipt">Received with thanks from <strong>{who}</strong> the sum of <strong>{money(rec.amount)}</strong> ({amountInWords(Number(rec.amount))}) by <strong>{str(rec.mode)}</strong>{rec.reference ? ` (ref. ${rec.reference})` : ''} against invoice <strong>{inv?.number || '—'}</strong>{rec.kind === 'Advance' ? ' as an advance' : ''}.</p>
        {inv && (() => {
          // As it stood with this receipt (a reprint later still shows the same figures).
          const upTo = round2(store.all('payments').filter((p) => p.invoiceId === inv.id && (str(p.date) < str(rec.date) || (str(p.date) === str(rec.date) && p.createdAt <= rec.createdAt)))
            .reduce((a, p) => a + (Number(p.amount) || 0), 0));
          const total = store.computed('invoices', inv).grandTotal;
          return <table className="doc-kv"><tbody>
            <tr><th>Invoice total</th><td>{money(total)}</td></tr>
            <tr><th>Received so far (incl. this receipt)</th><td>{money(upTo)}</td></tr>
            <tr><th>Balance after this receipt</th><td><strong>{money(Math.max(0, round2(total - upTo)))}</strong></td></tr>
          </tbody></table>;
        })()}
      </>;
    }
    case 'installations': {
      const pr = store.get('projects', rec.projectId);
      const who = str(store.get('customers', pr?.customerId)?.name) || '—';
      return <>
        <p className="doc-receipt">This is to certify that the {pr?.capacityKw ? `${pr.capacityKw} kW ` : ''}solar power system for <strong>{who}</strong> under project <strong>{pr ? str(pr.name) : '—'}</strong> {rec.status === 'Completed'
          ? <>has been installed and commissioned by our team led by {store.userName(rec.technician)} on {formatDate(rec.scheduledDate)}.</>
          : <>is being installed by our team led by {store.userName(rec.technician)} (scheduled {formatDate(rec.scheduledDate)}; status: {str(rec.status) || '—'}). This certificate becomes final when the work is completed.</>}</p>
        <FieldsTable entity={entity} rec={rec} skip={['projectId', 'technician', 'siteLat', 'siteLng']} />
        {typeof rec.siteLat === 'number' && typeof rec.siteLng === 'number' && <p className="small">Site location: {rec.siteLat}, {rec.siteLng}</p>}
        <Checklist entity={entity} rec={rec} />
        <Notes entity={entity} rec={rec} />
        <Photo store={store} rec={rec} k="photo" />
      </>;
    }
    case 'customers':
      return <Statement store={store} rec={rec} />;
    case 'projects':
      return <ProjectSummary store={store} entity={entity} rec={rec} />;
    case 'loans': {
      const rows = emiSchedule(Number(rec.amount), Number(rec.ratePct), Number(rec.tenureMonths), str(rec.firstEmiDate));
      const totalInt = round2(rows.reduce((a, r) => a + r.interest, 0));
      return <>
        <table className="doc-kv wide"><tbody>
          <tr><th>Customer</th><td>{store.titleOf('customers', rec.customerId)}</td></tr>
          <tr><th>Loan amount</th><td>{money(rec.amount)}</td></tr>
          <tr><th>Interest</th><td>{Number(rec.ratePct) || 0}% p.a. (reducing balance)</td></tr>
          <tr><th>Tenure</th><td>{Number(rec.tenureMonths) || 0} months</td></tr>
          <tr><th>Monthly EMI</th><td><strong>{money(computeEmi(Number(rec.amount), Number(rec.ratePct), Number(rec.tenureMonths)))}</strong></td></tr>
          <tr><th>Total interest</th><td>{money(totalInt)}</td></tr>
          <tr><th>Total payable</th><td>{money(round2(Number(rec.amount) + totalInt))}</td></tr>
        </tbody></table>
        {rows.length > 0 && (
          <table className="doc-items">
            <thead><tr><th>#</th><th>Date</th><th className="num">EMI</th><th className="num">Interest</th><th className="num">Principal</th><th className="num">Balance</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.n}><td>{r.n}</td><td>{r.date ? formatDate(r.date) : ''}</td><td className="num">{money(r.emi)}</td><td className="num">{money(r.interest)}</td><td className="num">{money(r.principal)}</td><td className="num">{money(r.balance)}</td></tr>)}</tbody>
          </table>
        )}
        <Checklist entity={entity} rec={rec} />
        <p className="small">Indicative schedule. The lender’s sanction letter is final.</p>
      </>;
    }
    case 'expenses':
      return <>
        <FieldsTable entity={entity} rec={rec} />
        <p className="doc-receipt">Amount: <strong>{money(rec.amount)}</strong> ({amountInWords(Number(rec.amount))})</p>
        <Photo store={store} rec={rec} k="receipt" />
      </>;
    default:
      return <>
        <FieldsTable entity={entity} rec={rec} skip={['customerId', 'leadId']} />
        <Checklist entity={entity} rec={rec} />
        <Notes entity={entity} rec={rec} />
        <Photo store={store} rec={rec} k="photo" />
      </>;
  }
}

/** Invoices (debit) and payments (credit) for one customer, oldest first, with a running balance. */
export function statementRows(store: Store, customerId: string) {
  const invoices = store.all('invoices').filter((i) => i.customerId === customerId && i.status !== 'Cancelled' && i.status !== 'Draft');
  const ids = new Set(invoices.map((i) => i.id));
  const rows = [
    ...invoices.map((i) => ({ date: str(i.date), doc: str(i.number), text: 'Invoice', debit: store.computed('invoices', i).grandTotal, credit: 0 })),
    ...store.all('payments').filter((p) => ids.has(String(p.invoiceId))).map((p) => ({
      date: str(p.date), doc: str(p.number), text: `Payment (${str(p.mode)}) — ${store.get('invoices', p.invoiceId)?.number || ''}`, debit: 0, credit: Number(p.amount) || 0,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.debit ? -1 : 1));
  let bal = 0;
  return rows.map((r) => { bal = round2(bal + r.debit - r.credit); return { ...r, balance: bal }; });
}

function Statement({ store, rec }: { store: Store; rec: Rec }) {
  const rows = statementRows(store, rec.id);
  const debit = round2(rows.reduce((a, r) => a + r.debit, 0)), credit = round2(rows.reduce((a, r) => a + r.credit, 0));
  return <>
    <table className="doc-items">
      <thead><tr><th>Date</th><th>Document</th><th>Details</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
      <tbody>
        {rows.map((r, i) => <tr key={i}><td>{formatDate(r.date)}</td><td>{r.doc}</td><td>{r.text}</td><td className="num">{r.debit ? money(r.debit) : ''}</td><td className="num">{r.credit ? money(r.credit) : ''}</td><td className="num">{money(r.balance)}</td></tr>)}
        {!rows.length && <tr><td colSpan={6} className="muted">No issued invoices yet.</td></tr>}
      </tbody>
      <tfoot><tr><th colSpan={3}>Total</th><th className="num">{money(debit)}</th><th className="num">{money(credit)}</th><th className="num">{money(round2(debit - credit))}</th></tr></tfoot>
    </table>
    <p className="doc-receipt">Closing balance: <strong>{money(round2(debit - credit))}</strong> {debit - credit > 0.005 ? 'due from you' : debit - credit < -0.005 ? 'in your favour' : '— nothing due'}.</p>
  </>;
}

function ProjectSummary({ store, entity, rec }: { store: Store; entity: Entity; rec: Rec }) {
  const moves = store.all('stockMoves').filter((m) => m.projectId === rec.id && m.direction === 'Out');
  const back = store.all('stockMoves').filter((m) => m.projectId === rec.id && m.direction === 'In');
  const qty = new Map<string, number>();
  for (const m of moves) qty.set(String(m.productId), round2((qty.get(String(m.productId)) || 0) + (Number(m.qty) || 0)));
  for (const m of back) qty.set(String(m.productId), round2((qty.get(String(m.productId)) || 0) - (Number(m.qty) || 0)));
  // Issued bills only; the margin is worked on the value before GST (GST is collected for the government).
  const invoices = store.all('invoices').filter((i) => i.projectId === rec.id && i.status !== 'Cancelled' && i.status !== 'Draft');
  const billedGross = round2(invoices.reduce((a, i) => a + store.computed('invoices', i).grandTotal, 0));
  const billed = round2(invoices.reduce((a, i) => a + store.totalsFor('invoices', i).taxable, 0));
  const received = round2(invoices.reduce((a, i) => a + store.paidOn(i.id), 0));
  const spent = round2(store.all('expenses').filter((e) => e.projectId === rec.id).reduce((a, e) => a + (Number(e.amount) || 0), 0));
  // At the cost each item went out at (recorded on the entry), else the product's cost.
  const costOf = (m: Rec) => { const r = Number(m.rate); return Number.isFinite(r) && r > 0 ? r : Number(store.get('products', m.productId)?.cost) || 0; };
  const material = round2(moves.reduce((a, m) => a + (Number(m.qty) || 0) * costOf(m), 0) - back.reduce((a, m) => a + (Number(m.qty) || 0) * costOf(m), 0));
  return <>
    <FieldsTable entity={entity} rec={rec} skip={['customerId']} />
    <table className="doc-kv wide"><tbody>
      <tr><th>Billed (before GST)</th><td>{money(billed)}</td></tr>
      <tr><th>Billed incl. GST</th><td>{money(billedGross)}</td></tr>
      <tr><th>Received</th><td>{money(received)}</td></tr>
      <tr><th>Material at cost</th><td>{money(material)}</td></tr>
      <tr><th>Other expenses</th><td>{money(spent)}</td></tr>
      <tr><th>Gross margin (billed before GST − material − expenses)</th><td><strong>{money(round2(billed - material - spent))}</strong></td></tr>
    </tbody></table>
    {qty.size > 0 && (
      <table className="doc-items">
        <thead><tr><th>Material sent to site</th><th className="num">Qty</th><th>Unit</th></tr></thead>
        <tbody>{[...qty].filter(([, q]) => q !== 0).map(([pid, q]) => <tr key={pid}><td>{store.titleOf('products', pid)}</td><td className="num">{q}</td><td>{str(store.get('products', pid)?.unit)}</td></tr>)}</tbody>
      </table>
    )}
    <Checklist entity={entity} rec={rec} />
    <Notes entity={entity} rec={rec} />
  </>;
}

function DocTerms({ k, rec, s }: { k: string; rec: Rec; s: CompanySettings }) {
  const terms = k === 'quotations' ? str(rec.terms || s.quoteTerms)
    : k === 'invoices' ? s.invoiceTerms
    : k === 'purchaseOrders' ? s.poTerms
    : k === 'dispatches' ? s.challanTerms
    : '';
  const notes = ['quotations', 'invoices', 'purchaseOrders', 'dispatches'].includes(k) ? str(rec.notes) : '';
  if (!terms && !notes && !(k === 'invoices' && s.declaration)) return null;
  return (
    <section className="doc-terms">
      {notes && <div className="doc-block"><div className="doc-label">Notes</div><div className="pre">{notes}</div></div>}
      {terms && <div className="doc-block"><div className="doc-label">Terms & conditions</div><div className="pre">{terms}</div></div>}
      {k === 'invoices' && s.declaration && <div className="doc-block"><div className="doc-label">Declaration</div><div>{s.declaration}</div></div>}
    </section>
  );
}
