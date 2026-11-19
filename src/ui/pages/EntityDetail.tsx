import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ENTITIES, getEntity } from '../../modules/registry';
import type { Entity, LineItem, Rec } from '../../lib/schema';
import { useStore } from '../../lib/store';
import { canDelete, canRead, canWrite } from '../../lib/rbac';
import { lineAmount, money } from '../../lib/money';
import { listOrder } from '../../lib/recordOrder';
import { formatDate, localDateOf } from '../../lib/format';
import { WhatsAppButton } from '../components/WhatsApp';
import { canonicalState, STATES } from '../../lib/states';
import { FieldValue, StatusBadge } from '../components/FieldValue';
import { Totals } from '../components/FieldInput';
import { errorText, useFeedback } from '../components/feedback';
import { NotFound } from './NotFound';
import { DocumentPreviewCard, RelatedDocuments } from './Documents';
import { ChallanReturns, PoReceipts, ProductStock } from './StockPanels';

export function EntityDetail() {
  const { entity: key = '', id = '' } = useParams();
  const store = useStore();
  const entity = getEntity(key);
  const rec = store.get(key, id);
  if (!entity) return <NotFound />;
  if (!rec) return <NotFound text="This record does not exist or was deleted." />;
  // Keyed by record: moving to another record (‹ ›, links) starts every panel and dialog fresh.
  return <DetailInner key={rec.id} entity={entity} rec={rec} />;
}

function DetailInner({ entity, rec }: { entity: Entity; rec: Rec }) {
  const store = useStore();
  const nav = useNavigate();
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const writable = canWrite(store.user, entity.module);
  const computed = store.computed(entity.key, rec);
  const title = store.titleOf(entity.key, rec.id);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };

  const remove = () => run(async () => {
    const refs = store.referencesTo(entity.key, rec.id);
    if (refs.length) {
      toast(`Cannot delete: used by ${refs.map((r) => `${r.count} ${r.entity.plural.toLowerCase()}`).join(', ')}.`, true);
      return;
    }
    const ok = await confirm({ title: `Delete ${title}?`, body: 'This cannot be undone.', okLabel: 'Delete', danger: true });
    if (!ok) return;
    await store.remove(entity.key, rec.id);
    toast(`${entity.label} deleted`);
    nav(`/m/${entity.key}`, { replace: true });
  });

  const actions: JSX.Element[] = [];
  // WhatsApp: the customer, lead, vendor or staff member behind the record, with the message that fits it now.
  actions.push(<WhatsAppButton key="wa" entity={entity.key} rec={rec} />);
  if (entity.printable) actions.push(<Link key="pr" className="btn" to={`/print/${entity.key}/${rec.id}`}>{entity.key === 'customers' ? 'Statement (PDF)' : 'Print / PDF'}</Link>);
  if (writable && entity.key === 'leads') {
    if (rec.customerId && store.get('customers', rec.customerId)) {
      actions.push(<Link key="cu" className="btn" to={`/m/customers/${rec.customerId}`}>Open customer</Link>);
    } else {
      actions.push(<button key="cv" className="btn" disabled={busy} onClick={() => run(async () => {
        const c = await store.convertLead(rec.id);
        toast('Customer created from lead');
        nav(`/m/customers/${c.id}`);
      })}>Convert to customer</button>);
    }
    actions.push(<Link key="sv" className="btn" to={`/m/surveys/new?leadId=${rec.id}`}>Schedule survey</Link>);
  }
  // Lead or site survey → quotation, with the customer and system size already filled in.
  const quoteFrom = (leadId: string, kw: unknown) => run(async () => {
    const c = await store.convertLead(leadId);
    nav(`/m/quotations/new?leadId=${leadId}&customerId=${c.id}${Number(kw) > 0 ? `&systemKw=${Number(kw)}` : ''}`);
  });
  if (entity.key === 'leads' && canWrite(store.user, 'sales') && canWrite(store.user, 'crm') && !['Won', 'Lost'].includes(String(rec.status))) {
    actions.push(<button key="nq" className="btn" disabled={busy} onClick={() => quoteFrom(rec.id, rec.capacityKw)}>New quotation</button>);
  }
  if (entity.key === 'surveys' && rec.leadId && store.get('leads', rec.leadId) && canWrite(store.user, 'sales') && canWrite(store.user, 'crm') && rec.status !== 'Cancelled') {
    actions.push(<button key="sq" className="btn" disabled={busy} onClick={() => quoteFrom(String(rec.leadId), rec.recommendedKw)}>Create quotation</button>);
  }
  if (entity.key === 'quotations' && writable && ['Draft', 'Sent'].includes(String(rec.status)) && !rec.invoiceId) {
    actions.push(<button key="co" className="btn primary" disabled={busy} onClick={() => run(async () => {
      const ok = await confirm({
        title: `Confirm ${rec.number} as an order?`,
        body: <>The quotation is marked <strong>Accepted</strong>, its lead <strong>Won</strong>, the customer an active project{canWrite(store.user, 'projects') && !rec.projectId ? <>, and a <strong>project</strong> is started for the installation</> : null}. You can invoice it next.</>,
        okLabel: 'Confirm order',
      });
      if (!ok) return;
      const r = await store.confirmQuotation(rec.id);
      toast(r.project ? `Order confirmed — project “${r.project.name}” started` : 'Order confirmed');
    })}>Confirm order</button>);
  }
  const linkedProject = entity.key === 'quotations' && rec.projectId ? store.get('projects', rec.projectId) : undefined;
  if (linkedProject) actions.push(<Link key="op" className="btn" to={`/m/projects/${linkedProject.id}`}>Open project</Link>);
  if (entity.key === 'customers' && canWrite(store.user, 'sales')) actions.push(<Link key="q" className="btn" to={`/m/quotations/new?customerId=${rec.id}`}>New quotation</Link>);
  if (entity.key === 'customers' && canWrite(store.user, 'projects')) actions.push(<Link key="p" className="btn" to={`/m/projects/new?customerId=${rec.id}`}>New project</Link>);
  // A cancelled invoice no longer counts: the quotation can be invoiced again.
  const linkedInv = entity.key === 'quotations' && rec.invoiceId ? store.get('invoices', rec.invoiceId) : undefined;
  const convertedTo = linkedInv && linkedInv.status !== 'Cancelled' ? linkedInv : undefined;
  if (convertedTo && canRead(store.user, 'finance')) {
    actions.push(<Link key="oi" className="btn" to={`/m/invoices/${convertedTo.id}`}>{convertedTo.number ? `Open invoice ${convertedTo.number}` : 'Open draft invoice'}</Link>);
  } else if (entity.key === 'quotations' && canWrite(store.user, 'finance') && !convertedTo && !['Rejected', 'Expired'].includes(String(rec.status))) {
    actions.push(<button key="qi" className="btn" disabled={busy} onClick={() => run(async () => {
      const inv = await store.quotationToInvoice(rec.id);
      toast(inv.number ? `Invoice ${inv.number} created` : 'Draft invoice created — it gets its number when you set it to Sent');
      nav(`/m/invoices/${inv.id}`);
    })}>Convert to invoice</button>);
  }
  // A draft has no number yet: issuing gives it the next one in the series, so drafts never leave gaps.
  if (entity.key === 'invoices' && writable && rec.status === 'Draft') {
    actions.push(<button key="is" className="btn primary" disabled={busy} onClick={() => run(async () => {
      const patch = store.issuePatch(rec);
      // No place of supply and no state on the customer: ask here (it decides CGST + SGST or IGST), starting from
      // the business's own state — shown, never assumed silently.
      const needPlace = !!store.companyState() && !canonicalState(rec.placeOfSupply) && !canonicalState(store.get('customers', rec.customerId)?.state);
      let place = store.companyState();
      const ok = await confirm({
        title: 'Issue this invoice?',
        body: <>
          <p>It gets the next invoice number{patch.date ? <> and today’s date ({formatDate(String(patch.date))})</> : null} and is marked <strong>Sent</strong>. After that its lines, price, customer and date are locked (GST rules): to correct it, cancel it and make a new one. Recording a payment issues it too.</p>
          {needPlace && <div className="field">
            <label htmlFor="issue-pos">Place of supply</label>
            <select id="issue-pos" className="input" defaultValue={place} onChange={(e) => { place = e.target.value; }}>
              {STATES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
            <span className="help">The customer has no state saved. Where is the system installed? It decides CGST + SGST or IGST.</span>
          </div>}
        </>,
        okLabel: 'Issue invoice',
      });
      if (!ok) return;
      const saved = await store.update('invoices', rec.id, { ...patch, ...(needPlace ? { placeOfSupply: place } : {}) }, { allowDuplicate: true });
      toast(`Invoice ${saved.number} issued`);
    })}>Issue invoice</button>);
  }
  if (entity.key === 'invoices' && canWrite(store.user, 'finance') && computed.balance > 0 && rec.status !== 'Cancelled') {
    actions.push(<Link key="pay" className="btn" to={`/m/payments/new?invoiceId=${rec.id}&amount=${computed.balance}`}>Record payment</Link>);
  }
  if (entity.key === 'invoices' && writable && rec.status !== 'Cancelled' && store.paidOn(rec.id) === 0) {
    actions.push(<button key="cx" className="btn danger" disabled={busy} onClick={() => run(async () => {
      const ok = await confirm({ title: `Cancel ${rec.number || 'this draft invoice'}?`, body: 'The invoice stays in your records (GST rules require that) but is marked cancelled and no longer counts as owed.', okLabel: 'Cancel invoice', danger: true });
      if (!ok) return;
      await store.update('invoices', rec.id, { status: 'Cancelled' }, { allowDuplicate: true });
      toast(`${rec.number || 'Draft invoice'} cancelled`);
    })}>Cancel invoice</button>);
  }
  if (entity.key === 'purchaseOrders' && canWrite(store.user, 'purchase') && rec.status !== 'Cancelled' && rec.status !== 'Draft' && computed.due > 0.005) {
    actions.push(<Link key="sp" className="btn" to={`/m/supplierPayments/new?purchaseOrderId=${rec.id}&vendorId=${rec.vendorId || ''}&amount=${computed.due}`}>Record supplier payment</Link>);
  }
  if (entity.key === 'projects' && canWrite(store.user, 'installation')) actions.push(<Link key="in" className="btn" to={`/m/installations/new?projectId=${rec.id}`}>Schedule installation</Link>);
  if (entity.key === 'projects' && canWrite(store.user, 'projects')) actions.push(<Link key="tk" className="btn" to={`/m/tasks/new?projectId=${rec.id}`}>Add task</Link>);
  if (entity.key === 'projects' && canWrite(store.user, 'inventory')) actions.push(<Link key="dc" className="btn" to={`/m/dispatches/new?projectId=${rec.id}`}>Send material</Link>);
  if (entity.key === 'projects' && canWrite(store.user, 'finance')) actions.push(<Link key="iv" className="btn" to={`/m/invoices/new?projectId=${rec.id}&customerId=${rec.customerId || ''}`}>New invoice</Link>);
  if (entity.key === 'customers' && canWrite(store.user, 'service')) actions.push(<Link key="tt" className="btn" to={`/m/tickets/new?customerId=${rec.id}`}>New ticket</Link>);

  // Records with a site: their photos (taken with the app's camera) and papers show on the record.
  const docsHere = ['customers', 'projects', 'leads', 'surveys', 'installations', 'tickets', 'amcs', 'dispatches'].includes(entity.key) && canRead(store.user, 'documents');
  const related = ENTITIES.filter((e) => canRead(store.user, e.module) && !(docsHere && e.key === 'documents')).flatMap((e) =>
    e.fields.filter((f) => f.type === 'ref' && f.ref === entity.key).map((f) => ({ e, f, rows: store.all(e.key).filter((r) => r[f.key] === rec.id) })))
    .filter((x) => x.rows.length);

  const plain = entity.fields.filter((f) => !f.hidden && !['items', 'textarea', 'checklist'].includes(f.type));
  const long = entity.fields.filter((f) => !f.hidden && ['textarea', 'checklist'].includes(f.type));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="muted small"><Link to={`/m/${entity.key}`}>{entity.plural}</Link>{rec.number && title !== rec.number ? ` · ${rec.number}` : ''}</div>
          <h1>{title}</h1>
        </div>
        <div className="spacer" />
        <RecordPager entity={entity} id={rec.id} />
        <div className="btn-row detail-actions">
          {actions}
          {writable && <Link className="btn primary" to={`/m/${entity.key}/${rec.id}/edit`}>Edit</Link>}
          {writable && canDelete(store.user, entity.module) && !entity.noDelete && <button className="btn danger" disabled={busy} onClick={remove}>Delete</button>}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <dl className="dl">
            {plain.map((f) => (
              <div key={f.key}><dt>{f.label}</dt><dd><FieldValue field={f} rec={rec} /></dd></div>
            ))}
            {(entity.computed || []).map((c) => (
              <div key={c.key}><dt>{c.label}</dt><dd><strong>{c.type === 'text' ? <StatusBadge value={store.computedText(entity.key, rec, c.key)} /> : c.type === 'money' ? money(computed[c.key]) : computed[c.key]}</strong></dd></div>
            ))}
            <div><dt>Created</dt><dd>{formatDate(rec.createdAt)}{rec.createdBy ? ` by ${store.userName(rec.createdBy)}` : ''}</dd></div>
            <div><dt>Last updated</dt><dd>{formatDate(rec.updatedAt)}</dd></div>
          </dl>
        </div>

        {entity.fields.some((f) => f.type === 'items') && (
          <div className="card">
            <h2>Items</h2>
            <ItemsTable items={Array.isArray(rec.items) ? (rec.items as LineItem[]) : []} buying={entity.key === 'purchaseOrders'} />
            <div style={{ display: 'flex', marginTop: 10 }}><Totals t={store.totalsFor(entity.key, rec)} /></div>
          </div>
        )}

        {long.filter((f) => rec[f.key] && (!Array.isArray(rec[f.key]) || f.type === 'checklist')).map((f) => (
          <div className="card" key={f.key}>
            <h2>{f.label}</h2>
            {f.type === 'checklist' ? (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                {f.items!.map((it) => {
                  const done = ((rec[f.key] as string[]) || []).includes(it);
                  return <li key={it} style={{ padding: '3px 0' }}>{done ? '✅' : '⬜'} {it}</li>;
                })}
              </ul>
            ) : <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(rec[f.key])}</div>}
          </div>
        ))}

        {(() => {
          const lat = rec.siteLat ?? rec.lat, lng = rec.siteLng ?? rec.lng;
          return typeof lat === 'number' && typeof lng === 'number' ? (
            <div className="card">
              <h2>Site location</h2>
              <a className="btn" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${Number(lat)},${Number(lng)}`}>Open in Google Maps</a>
            </div>
          ) : null;
        })()}

        {entity.key === 'products' && <ProductStock product={rec} />}
        {entity.key === 'purchaseOrders' && <PoReceipts po={rec} />}
        {entity.key === 'dispatches' && <ChallanReturns dc={rec} />}
        {entity.key === 'documents' && <DocumentPreviewCard rec={rec} />}
        {docsHere && <RelatedDocuments entity={entity.key} rec={rec} />}

        <ActivityLog entity={entity} rec={rec} />

        {related.map(({ e, f, rows }) => (
          <div className="card" key={e.key + f.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h2>{e.plural} ({rows.length})</h2>
            </div>
            <div className="table-wrap">
              <table>
                <tbody>
                  {rows.slice(0, 20).map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => nav(`/m/${e.key}/${r.id}`)}>
                      <td><Link to={`/m/${e.key}/${r.id}`}>{store.titleOf(e.key, r.id)}</Link></td>
                      {e.statusField && <td><FieldValue field={e.fields.find((x) => x.key === e.statusField)!} rec={r} /></td>}
                      {e.computed?.[0] && <td className="num">{money(store.computed(e.key, r)[e.computed[0].key])}</td>}
                      <td className="muted">{formatDate(localDateOf(r.createdAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 20 && <p className="muted small">Showing 20 of {rows.length}.</p>}
          </div>
        ))}
      </div>
    </>
  );
}

/** A record's history: created, what changed (old → new), and notes from the team, newest first. */
function ActivityLog({ entity, rec }: { entity: Entity; rec: Rec }) {
  const store = useStore();
  const { toast } = useFeedback();
  const [text, setText] = useState('');
  const [show, setShow] = useState<'all' | 'note' | 'changed'>('all');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const all = store.activityFor(entity.key, rec.id);
  const items = all.filter((a) => show === 'all' || a.kind === show || (show === 'changed' && a.kind === 'created'));
  const shown = more ? items : items.slice(0, 15);
  const add = async () => {
    if (busy) return;
    setBusy(true);
    try { await store.addNote(entity.key, rec.id, text); setText(''); toast('Note added'); }
    catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };
  const when = (iso: string) => {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  return (
    <section className="card activity" aria-label="Activity">
      <div className="chart-head">
        <h2>Activity</h2>
        <div className="seg" role="group" aria-label="Show">
          {([['all', 'All'], ['note', 'Notes'], ['changed', 'Changes']] as const).map(([k, l]) => (
            <button key={k} type="button" className={show === k ? 'on' : ''} aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="note-box">
        <textarea className="input" rows={2} maxLength={4000} aria-label="Write a note" placeholder="Write a note — a call, a promise, a reminder for the team…"
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void add(); }} />
        <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={() => void add()}>Add note</button>
      </div>
      {items.length === 0 ? <p className="muted small">Nothing yet. Changes to this {entity.label.toLowerCase()} and notes appear here.</p> : (
        <ol className="timeline">
          {shown.map((a) => {
            const who = a.createdBy ? store.userName(a.createdBy) : 'Someone';
            const changes = (Array.isArray(a.changes) ? a.changes : []) as { label: string; from: string; to: string }[];
            return (
              <li key={a.id} className={'tl-' + a.kind}>
                <span className="avatar sm" aria-hidden>{who.trim().charAt(0).toUpperCase() || '?'}</span>
                <div className="tl-body">
                  <div className="tl-head"><strong>{who}</strong> <span className="muted small" title={new Date(a.createdAt).toLocaleString('en-IN')}>{when(a.createdAt)}</span></div>
                  {a.kind === 'note' && <div className="tl-note">{String(a.text)}</div>}
                  {a.kind === 'created' && <div className="muted">{String(a.text || 'Created')}</div>}
                  {a.kind === 'changed' && (
                    <ul className="tl-changes">
                      {changes.map((c, i) => <li key={i}><span className="muted">{c.label}:</span> <s className="muted">{c.from}</s> → <strong>{c.to}</strong></li>)}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > 15 && !more && <button type="button" className="link-btn small" onClick={() => setMore(true)}>Show all {items.length}</button>}
    </section>
  );
}

/**
 * ‹ 3 / 25 › — step to the previous or next record in the list it was opened from (same filters and sort).
 * Alt + ← / → do the same from the keyboard.
 */
function RecordPager({ entity, id }: { entity: Entity; id: string }) {
  const store = useStore();
  const nav = useNavigate();
  const saved = listOrder(entity.key);
  const fallback = [...store.all(entity.key)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => r.id);
  // Only records that still exist and that this person may see.
  const order = (saved && saved.includes(id) ? saved : fallback).filter((x) => x === id || store.get(entity.key, x));
  const i = order.indexOf(id);
  const go = (to: number) => { const next = order[to]; if (next) nav(`/m/${entity.key}/${next}`, { replace: true }); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.altKey || (e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); go(i - 1); }
      if (e.key === 'ArrowRight' && i < order.length - 1) { e.preventDefault(); go(i + 1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  if (i < 0 || order.length < 2) return null;
  return (
    <div className="record-pager" role="group" aria-label={`${entity.label} ${i + 1} of ${order.length}`}>
      <span className="muted small">{i + 1} / {order.length}</span>
      <button type="button" className="btn sm" aria-label={`Previous ${entity.label.toLowerCase()}`} title="Previous (Alt + ←)" disabled={i === 0} onClick={() => go(i - 1)}>‹</button>
      <button type="button" className="btn sm" aria-label={`Next ${entity.label.toLowerCase()}`} title="Next (Alt + →)" disabled={i === order.length - 1} onClick={() => go(i + 1)}>›</button>
    </div>
  );
}

/** Lines on a saved document: the product name links to the product; amounts include the line discount. */
export function ItemsTable({ items, buying }: { items: LineItem[]; buying?: boolean }) {
  const store = useStore();
  const lines = items.filter((it) => it && typeof it === 'object');
  if (!lines.length) return <p className="muted">No items.</p>;
  const anyDiscount = lines.some((it) => Number(it.discountPct) > 0);
  return (
    <div className="table-wrap">
      <table className="lines-table">
        <thead><tr><th>#</th><th>Product / description</th><th>HSN</th><th className="num">Qty</th><th>Unit</th><th className="num">{buying ? 'Cost' : 'Rate'}</th>{anyDiscount && <th className="num">Disc %</th>}<th className="num">GST %</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {lines.map((it, i) => {
            const p = it.productId ? store.get('products', it.productId) : undefined;
            const name = p ? String(p.name) : '';
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  {p ? <Link to={`/m/products/${p.id}`} className="line-product">{name}</Link>
                    : it.productId ? <span className="muted">(product removed)</span> : null}
                  {(!p || (it.description && it.description !== name && !it.description.startsWith(name + ' — '))) && it.description && <div className={p ? 'muted small' : ''}>{it.description}</div>}
                  {p && it.description?.startsWith(name + ' — ') && <div className="muted small">{it.description.slice(name.length + 3)}</div>}
                </td>
                <td>{it.hsn || ''}</td>
                <td className="num">{it.qty}</td><td>{it.unit || ''}</td><td className="num">{money(it.rate)}</td>
                {anyDiscount && <td className="num">{Number(it.discountPct) > 0 ? `${it.discountPct}%` : ''}</td>}
                <td className="num">{it.gstRate}%</td><td className="num">{money(lineAmount(it))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

