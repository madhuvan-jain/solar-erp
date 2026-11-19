import { DEFAULT_GST } from '../../lib/productTax';
import { tracksStock } from '../../lib/store/stock';
import { CameraButton } from './GeoCamera';
import { useMemo, useState } from 'react';
import type { Field, LineItem, Rec } from '../../lib/schema';
import { getEntity } from '../../modules/registry';
import { useStore, type FileRef } from '../../lib/store';
import { computeTotals, lineAmount, money } from '../../lib/money';
import { errorText } from './feedback';
import { FileLink } from './FieldValue';
import { CREATE_NEW, QuickCreate, canQuickCreate, prefillFor, productFromLine } from './QuickCreate';

interface Props {
  /** reports when a file upload starts (+1) or finishes (-1), so the form can wait for it */
  onUploading?: (delta: number) => void;
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  interState?: boolean;
  discount?: number;
  /** the entity being edited — purchase orders price lines at cost, sales documents at sale price */
  entityKey?: string;
  /** element ids are this + field key (the create-new popup uses its own, so labels never clash) */
  idPrefix?: string;
  /** no "Create new…" in pickers (inside the popup itself) */
  noCreate?: boolean;
  /** the rest of the form, used to pre-fill a record created from a picker */
  formValues?: Record<string, unknown>;
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

export function FieldInput({ field, value, onChange, error, interState, discount, onUploading, entityKey, idPrefix = 'f-', noCreate, formValues }: Props) {
  const store = useStore();
  const [creating, setCreating] = useState(false);
  const id = idPrefix + field.key;
  const cls = 'input' + (error ? ' err' : '');
  const aria = { id, 'aria-invalid': !!error, 'aria-describedby': error ? id + '-err' : undefined };
  let control: JSX.Element;

  switch (field.type) {
    case 'textarea':
      control = <textarea className={cls} {...aria} value={str(value)} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'select':
      control = (
        <select className={cls} {...aria} value={str(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Select —</option>
          {field.options!.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      break;
    case 'ref': {
      const list = store.all(field.ref!);
      const target = getEntity(field.ref!);
      const creatable = !noCreate && canQuickCreate(store, field.ref);
      control = (
        <>
          <select className={cls} {...aria} value={str(value)}
            onChange={(e) => (e.target.value === CREATE_NEW ? setCreating(true) : onChange(e.target.value))}>
            <option value="">— Select —</option>
            {list.map((r) => <option key={r.id} value={r.id}>{store.titleOf(field.ref!, r.id)}{r.number && store.titleOf(field.ref!, r.id) !== r.number ? ` (${r.number})` : ''}</option>)}
            {!!value && !store.get(field.ref!, value) && <option value={str(value)}>(deleted record)</option>}
            {creatable && <option value={CREATE_NEW}>+ Create new {target!.label.toLowerCase()}…</option>}
          </select>
          {creating && (
            <QuickCreate entityKey={field.ref!} initial={prefillFor(store, field.ref!, formValues)}
              onCreated={(r) => onChange(r.id)} onClose={() => setCreating(false)} />
          )}
        </>
      );
      break;
    }
    case 'user':
      control = (
        <select className={cls} {...aria} value={str(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Unassigned —</option>
          {store.users.filter((u) => u.active && u.role !== 'pending').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      );
      break;
    case 'bool':
      return (
        <label className="check">
          <input type="checkbox" id={id} checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {field.label}
        </label>
      );
    case 'number': case 'money': case 'percent':
      control = (
        <input className={cls} {...aria} type="number" inputMode="decimal" step="any"
          min={field.min} max={field.max} value={str(value)}
          onChange={(e) => onChange(e.target.value)} onWheel={(e) => (e.target as HTMLInputElement).blur()} />
      );
      break;
    case 'date':
      control = <input className={cls} {...aria} type="date" value={str(value).slice(0, 10)} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'time':
      control = <input className={cls} {...aria} type="time" value={str(value)} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'datetime':
      control = <input className={cls} {...aria} type="datetime-local" value={str(value).slice(0, 16)} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'email':
      control = <input className={cls} {...aria} type="email" autoComplete="off" value={str(value)} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'phone':
      control = <input className={cls} {...aria} type="tel" inputMode="tel" value={str(value)} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'pincode':
      control = <input className={cls} {...aria} inputMode="numeric" autoComplete="postal-code" maxLength={7} value={str(value)} onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, ''))} />;
      break;
    case 'gstin': case 'pan':
      control = <input className={cls} {...aria} style={{ textTransform: 'uppercase' }} maxLength={field.type === 'gstin' ? 15 : 10} value={str(value)} onChange={(e) => onChange(e.target.value.toUpperCase())} />;
      break;
    case 'file':
      control = <FileInput id={id} value={value as FileRef | undefined} onChange={onChange} onUploading={onUploading} />;
      break;
    case 'checklist': {
      const done = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div role="group" aria-labelledby={id + '-l'}>
          {field.items!.map((it) => (
            <label key={it} className="check">
              <input type="checkbox" checked={done.includes(it)}
                onChange={(e) => onChange(e.target.checked ? [...done, it] : done.filter((x) => x !== it))} /> {it}
            </label>
          ))}
        </div>
      );
      break;
    }
    case 'items':
      control = <ItemsEditor value={Array.isArray(value) ? (value as LineItem[]) : []} onChange={onChange} interState={interState} discount={discount} entityKey={entityKey} formValues={formValues} />;
      break;
    default:
      control = <input className={cls} {...aria} type="text" maxLength={field.maxLength} value={str(value)} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div className={'field' + (['textarea', 'items', 'checklist'].includes(field.type) ? ' wide' : '')}>
      <label htmlFor={id} id={id + '-l'}>{field.label}{field.required && <span className="req"> *</span>}</label>
      {control}
      {field.help && <span className="help">{field.help}</span>}
      {error && <span className="error" id={id + '-err'}>{error}</span>}
    </div>
  );
}

function FileInput({ id, value, onChange, onUploading }: { id: string; value?: FileRef; onChange: (v: unknown) => void; onUploading?: (d: number) => void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {value && <FileLink file={value} />}
      {value && <button type="button" className="btn sm danger" onClick={() => onChange(null)}>Remove</button>}
      <CameraButton disabled={busy} onPhoto={async (p) => {
        setBusy(true); setErr(''); onUploading?.(1);
        try { onChange({ ...(await store.backend.uploadFile(p.file)), ...(p.geo ? { geo: p.geo } : {}) }); }
        catch (x) { setErr(errorText(x)); }
        finally { setBusy(false); onUploading?.(-1); }
      }} />
      <input id={id} type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true); setErr(''); onUploading?.(1);
          try { onChange(await store.backend.uploadFile(f)); }
          catch (x) { setErr(errorText(x)); }
          finally { setBusy(false); onUploading?.(-1); }
        }} />
      {busy && <span className="muted small">Uploading…</span>}
      {err && <span className="error" role="alert">{err}</span>}
    </div>
  );
}

// A typed (custom) line starts at 18% GST — what services and most goods carry; solar panels and inverters picked
// from Products bring their own 5%.
const blank = (): LineItem => ({ description: '', qty: 1, unit: 'Nos', rate: 0, discountPct: 0, gstRate: Number(DEFAULT_GST) });

function ItemsEditor({ value, onChange, interState, discount, entityKey, formValues }: { value: LineItem[]; onChange: (v: unknown) => void; interState?: boolean; discount?: number; entityKey?: string; formValues?: Record<string, unknown> }) {
  const store = useStore();
  const [creatingLine, setCreatingLine] = useState<number | null>(null);
  const canCreateProduct = canQuickCreate(store, 'products');
  const products = useMemo(() => [...store.all('products')].sort((a, b) => String(a.name).localeCompare(String(b.name))), [store, store.getVersion()]);
  const totals = useMemo(() => computeTotals(value, discount, interState), [value, discount, interState]);
  const buying = entityKey === 'purchaseOrders';
  const showStock = entityKey === 'quotations' || entityKey === 'invoices' || entityKey === 'dispatches';

  const set = (i: number, patch: Partial<LineItem>) => onChange(value.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const pick = (i: number, pid: string) => {
    if (pid === CREATE_NEW) return setCreatingLine(i);
    if (!pid) return set(i, { productId: undefined });
    const p = store.get('products', pid);
    if (p) fillFrom(i, p);
  };
  const fillFrom = (i: number, p: Rec) => {
    // Buying: the purchase cost only — never our sale price (left at 0 to fill in when the product has no cost).
    const price = Number(buying ? p.cost : p.price) || 0;
    set(i, {
      productId: p.id, description: [p.name, p.specs].filter(Boolean).join(' — '), hsn: String(p.hsn || ''),
      unit: String(p.unit || 'Nos'), rate: price, gstRate: Number(p.gstRate) || 0,
    });
  };
  const num = (s: string) => (s === '' ? NaN : Number(s));
  const show = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? n : '');
  const stockNote = (it: LineItem) => {
    // Buying a product with no purchase cost saved: the line starts at 0 — ask for the cost, never assume our price.
    if (buying && it.productId && !(Number(it.rate) > 0)) return <span className="small stock-short">Enter the purchase cost</span>;
    if (!showStock || !it.productId) return null;
    const p = store.get('products', it.productId);
    if (!p || !tracksStock(p)) return null;
    // A challan already sent has taken its stock out; one going out takes it from its own warehouse when named.
    if (entityKey === 'dispatches' && formValues?.stockIssued) return null;
    const wh = entityKey === 'dispatches' ? String(formValues?.warehouseId || '') : '';
    const have = wh ? store.stockIn(it.productId, wh) : store.stockOf(it.productId);
    const need = value.filter((x) => x.productId === it.productId).reduce((s, x) => s + (Number(x.qty) || 0), 0);
    return <span className={'small ' + (have < need ? 'stock-short' : 'muted')}>In stock: {have}{have < need ? ' — not enough' : ''}</span>;
  };

  const productSelect = (it: LineItem, i: number) => (
    <select className="input" aria-label={`Product for line ${i + 1}`} value={it.productId || ''} onChange={(e) => pick(i, e.target.value)}>
      <option value="">Custom item</option>
      {products.map((p) => <option key={p.id} value={p.id}>{String(p.name)}{p.sku ? ` · ${p.sku}` : ''}</option>)}
      {!!it.productId && !store.get('products', it.productId) && <option value={it.productId}>(deleted product)</option>}
      {canCreateProduct && <option value={CREATE_NEW}>+ Create new product…</option>}
    </select>
  );
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      <div className="table-wrap items-table">
        <table>
          <thead>
            <tr><th>#</th><th>Product</th><th>Description</th><th>HSN/SAC</th><th className="num">Qty</th><th>Unit</th><th className="num">{buying ? 'Cost' : 'Rate'}</th><th className="num">Disc %</th><th className="num">GST %</th><th className="num">Amount</th><th /></tr>
          </thead>
          <tbody>
            {value.map((it, i) => (
              <tr key={i}>
                <td className="muted">{i + 1}</td>
                <td style={{ minWidth: 150 }}>{productSelect(it, i)}{stockNote(it)}</td>
                <td style={{ minWidth: 180 }}><input className="input" aria-label={`Description line ${i + 1}`} value={it.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                <td style={{ width: 90 }}><input className="input" aria-label={`HSN line ${i + 1}`} value={it.hsn || ''} onChange={(e) => set(i, { hsn: e.target.value })} /></td>
                <td style={{ width: 80 }}><input className="input" aria-label={`Quantity line ${i + 1}`} type="number" min={0} step="any" value={show(it.qty)} onChange={(e) => set(i, { qty: num(e.target.value) })} /></td>
                <td style={{ width: 76 }}><input className="input" aria-label={`Unit line ${i + 1}`} value={it.unit || ''} onChange={(e) => set(i, { unit: e.target.value })} /></td>
                <td style={{ width: 110 }}><input className="input" aria-label={`Rate line ${i + 1}`} type="number" min={0} step="any" value={show(it.rate)} onChange={(e) => set(i, { rate: num(e.target.value) })} /></td>
                <td style={{ width: 72 }}><input className="input" aria-label={`Discount line ${i + 1}`} type="number" min={0} max={100} step="any" value={show(it.discountPct ?? 0)} onChange={(e) => set(i, { discountPct: e.target.value === '' ? 0 : num(e.target.value) })} /></td>
                <td style={{ width: 72 }}><input className="input" aria-label={`GST line ${i + 1}`} type="number" min={0} max={100} step="any" value={show(it.gstRate)} onChange={(e) => set(i, { gstRate: num(e.target.value) })} /></td>
                <td className="num">{money(lineAmount(it))}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn sm ghost" aria-label={`Move line ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="btn sm ghost" aria-label={`Remove line ${i + 1}`} onClick={() => remove(i)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="items-cards">
        {value.map((it, i) => (
          <div className="card" key={i} style={{ padding: 10, display: 'grid', gap: 8 }}>
            <div className="muted small">Line {i + 1}</div>
            {productSelect(it, i)}
            {stockNote(it)}
            <input className="input" placeholder="Description" value={it.description} onChange={(e) => set(i, { description: e.target.value })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <label className="mini">Qty<input className="input" placeholder="Qty" type="number" inputMode="decimal" value={show(it.qty)} onChange={(e) => set(i, { qty: num(e.target.value) })} /></label>
              <label className="mini">{buying ? 'Cost' : 'Rate'}<input className="input" placeholder="Rate" type="number" inputMode="decimal" value={show(it.rate)} onChange={(e) => set(i, { rate: num(e.target.value) })} /></label>
              <label className="mini">GST %<input className="input" placeholder="GST %" type="number" inputMode="decimal" value={show(it.gstRate)} onChange={(e) => set(i, { gstRate: num(e.target.value) })} /></label>
              <label className="mini">Unit<input className="input" value={it.unit || ''} onChange={(e) => set(i, { unit: e.target.value })} /></label>
              <label className="mini">Disc %<input className="input" type="number" inputMode="decimal" value={show(it.discountPct ?? 0)} onChange={(e) => set(i, { discountPct: e.target.value === '' ? 0 : num(e.target.value) })} /></label>
              <label className="mini">HSN<input className="input" value={it.hsn || ''} onChange={(e) => set(i, { hsn: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{money(lineAmount(it))}</strong>
              <button type="button" className="btn sm danger" onClick={() => remove(i)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <button type="button" className="btn" onClick={() => onChange([...value, blank()])}>+ Add line</button>
        <Totals t={totals} />
      </div>
      {creatingLine !== null && value[creatingLine] && (
        <QuickCreate entityKey="products" initial={productFromLine(value[creatingLine], buying)}
          onCreated={(p) => fillFrom(creatingLine, p)} onClose={() => setCreatingLine(null)} />
      )}
    </div>
  );
}

export function Totals({ t }: { t: ReturnType<typeof computeTotals> }) {
  return (
    <div className="totals">
      {t.lineDiscount > 0 && <div><span>Gross amount</span><span>{money(t.gross)}</span></div>}
      {t.lineDiscount > 0 && <div><span>Line discounts</span><span>− {money(t.lineDiscount)}</span></div>}
      <div><span>Subtotal</span><span>{money(t.subtotal)}</span></div>
      {t.discount > 0 && <div><span>Discount</span><span>− {money(t.discount)}</span></div>}
      <div><span>Taxable value</span><span>{money(t.taxable)}</span></div>
      {t.igst > 0 ? <div><span>IGST</span><span>{money(t.igst)}</span></div> : <>
        <div><span>CGST</span><span>{money(t.cgst)}</span></div>
        <div><span>SGST</span><span>{money(t.sgst)}</span></div>
      </>}
      {t.roundOff !== 0 && <div><span>Round off</span><span>{t.roundOff > 0 ? '+' : '−'} {money(Math.abs(t.roundOff))}</span></div>}
      <div className="grand"><span>Total</span><span>{money(t.grandTotal)}</span></div>
    </div>
  );
}
