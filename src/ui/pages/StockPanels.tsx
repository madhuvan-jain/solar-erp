// Stock on the screens: receiving goods on a purchase order (part deliveries too), material coming back
// from site on a challan, and a product's stock card (per warehouse, on order, value, count and transfer).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../lib/store';
import type { Rec } from '../../lib/schema';
import { canDelete, canWrite } from '../../lib/rbac';
import { money } from '../../lib/money';
import { formatDate, todayIso } from '../../lib/format';
import { qtyByProduct, receivedOf, remainingOf, STOCK_REASONS, tracksStock } from '../../lib/store/stock';
import { errorText, useDialogFocus, useFeedback } from '../components/feedback';

const n = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 3 });

function QtyDialog({ title, intro, rows, extra, okLabel, onSave, onClose }: {
  title: string; intro: string; rows: { id: string; name: string; max: number; hint: string }[];
  extra?: React.ReactNode; okLabel: string; onSave: (q: Record<string, number>) => Promise<void>; onClose: () => void;
}) {
  const dlg = useDialogFocus(true, onClose);
  const { toast } = useFeedback();
  const [q, setQ] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, String(r.max)])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await onSave(Object.fromEntries(Object.entries(q).map(([k, v]) => [k, Number(v) || 0]))); onClose(); }
    catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };
  return (
    <div className="modal-back">
      <div ref={dlg} className="modal" role="dialog" aria-modal="true" aria-labelledby="qd-title">
        <h2 id="qd-title">{title}</h2>
        <p className="muted small">{intro}</p>
        <table className="table qty-table">
          <thead><tr><th>Item</th><th className="num">Quantity</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.name}<div className="muted small">{r.hint}</div></td>
              <td className="num"><input className="input" type="number" min={0} max={r.max} step="any" inputMode="decimal" aria-label={`Quantity of ${r.name}`}
                value={q[r.id]} onChange={(e) => setQ({ ...q, [r.id]: e.target.value })} /></td></tr>
          ))}</tbody>
        </table>
        {extra}
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : okLabel}</button>
        </div>
      </div>
    </div>
  );
}

function WarehouseSelect({ value, onChange, label, allowNone }: { value: string; onChange: (v: string) => void; label: string; allowNone?: string }) {
  const store = useStore();
  return (
    <label className="field"><span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNone !== undefined && <option value="">{allowNone}</option>}
        {store.all('warehouses').map((w) => <option key={w.id} value={w.id}>{String(w.name)}</option>)}
      </select>
    </label>
  );
}

/** Purchase order: "Receive goods" and what has arrived so far. */
export function PoReceipts({ po }: { po: Rec }) {
  const store = useStore();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [wh, setWh] = useState(String(po.warehouseId || store.settings().defaultWarehouse || ''));
  const ordered = qtyByProduct(po.items);
  const got = receivedOf(po);
  const left = remainingOf(po);
  const goods = [...ordered].filter(([pid]) => tracksStock(store.get('products', pid)));
  if (!goods.length) return null;
  const can = canWrite(store.user, 'inventory') && canWrite(store.user, 'purchase') && ['Ordered', 'Partially Received'].includes(String(po.status)) && goods.some(([pid]) => left.get(pid));
  return (
    <div className="card">
      <div className="card-head"><h2>Goods received</h2>
        {can && <button type="button" className="btn primary sm" onClick={() => setOpen(true)}>Receive goods</button>}
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Still due</th></tr></thead>
        <tbody>{goods.map(([pid, q]) => (
          <tr key={pid}><td><Link to={`/m/products/${pid}`}>{store.titleOf('products', pid)}</Link></td>
            <td className="num">{n(q)}</td><td className="num">{n(Number(got[pid]) || 0)}</td><td className="num">{left.get(pid) ? <strong>{n(left.get(pid)!)}</strong> : '✓'}</td></tr>
        ))}</tbody>
      </table></div>
      {po.status === 'Draft' && <p className="muted small">Set the status to Ordered once the order is placed; then goods can be received.</p>}
      {open && (
        <QtyDialog title={`Receive goods — ${po.number}`} okLabel="Add to stock"
          intro="Enter what actually arrived. Anything still due stays on the order until it comes."
          rows={goods.filter(([pid]) => left.get(pid)).map(([pid]) => ({ id: pid, name: store.titleOf('products', pid), max: left.get(pid)!, hint: `${n(left.get(pid)!)} still due` }))}
          extra={<div className="form-grid" style={{ marginTop: 10 }}>
            <label className="field"><span>Received on</span><input className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} /></label>
            <WarehouseSelect value={wh} onChange={setWh} label="Into warehouse" allowNone="— No particular warehouse —" />
          </div>}
          onClose={() => setOpen(false)}
          onSave={async (q) => {
            const lines = await store.receiveGoods(po.id, q, { date, warehouseId: wh });
            toast(lines ? 'Goods added to stock' : 'Nothing was received', !lines);
          }} />
      )}
    </div>
  );
}

/** Delivery challan: what is at site from this challan, and "Return from site". */
export function ChallanReturns({ dc }: { dc: Rec }) {
  const store = useStore();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  if (!dc.stockIssued) return null;
  const at = store.outstandingOn(dc);
  if (!at.size && !store.movesFrom(dc.id).length) return null;
  const can = canWrite(store.user, 'inventory') && at.size > 0;
  return (
    <div className="card">
      <div className="card-head"><h2>Material at site</h2>
        {can && <button type="button" className="btn sm" onClick={() => setOpen(true)}>Return from site</button>}
      </div>
      {at.size ? (
        <ul className="plain-list">{[...at].map(([pid, q]) => <li key={pid}>{n(q)} × <Link to={`/m/products/${pid}`}>{store.titleOf('products', pid)}</Link></li>)}</ul>
      ) : <p className="muted">Everything on this challan has come back.</p>}
      {open && (
        <QtyDialog title={`Return from site — ${dc.number}`} okLabel="Put back into stock"
          intro="Enter what came back unused. It goes back into stock at the cost it went out at."
          rows={[...at].map(([pid, q]) => ({ id: pid, name: store.titleOf('products', pid), max: q, hint: `${n(q)} at site` }))}
          extra={<label className="field" style={{ marginTop: 10 }}><span>Came back on</span><input className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} /></label>}
          onClose={() => setOpen(false)}
          onSave={async (q) => { await store.returnFromSite(dc.id, q, date); toast('Returned material is back in stock'); }} />
      )}
    </div>
  );
}

/** Product: stock per warehouse, on order, average cost and value, latest entries, count and transfer. */
export function ProductStock({ product }: { product: Rec }) {
  const store = useStore();
  const { toast } = useFeedback();
  const [dialog, setDialog] = useState<'count' | 'move' | null>(null);
  const tracked = tracksStock(product);
  const places = store.stockByWarehouse(product.id);
  const val = store.stockValuation(product.id);
  const coming = store.onOrder(product.id);
  const moves = useMemo(() => store.all('stockMoves').filter((m) => m.productId === product.id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.createdAt.localeCompare(a.createdAt)).slice(0, 12), [store, store.getVersion(), product.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tracked) return <div className="card"><h2>Stock</h2><p className="muted">This is a service, so no stock is kept for it.</p></div>;
  const manager = canDelete(store.user, 'inventory');
  const low = Number(product.reorderLevel) > 0 && val.qty <= Number(product.reorderLevel);
  return (
    <div className="card">
      <div className="card-head"><h2>Stock</h2>
        <div className="btn-row">
          {manager && <button type="button" className="btn sm" onClick={() => setDialog('count')}>Count / adjust</button>}
          {canWrite(store.user, 'inventory') && store.all('warehouses').length > 0 && val.qty > 0 && <button type="button" className="btn sm" onClick={() => setDialog('move')}>Move between warehouses</button>}
        </div>
      </div>
      <div className="stock-kpis">
        <div><span className="muted small">In stock</span><strong className={low ? 'bad-text' : ''}>{n(val.qty)} {String(product.unit || '')}</strong>{low && <span className="badge bad">Low</span>}</div>
        <div><span className="muted small">On order</span><strong>{n(coming)}</strong></div>
        <div><span className="muted small">Average cost</span><strong>{money(val.avg)}</strong></div>
        <div><span className="muted small">Stock value</span><strong>{money(val.value)}</strong></div>
      </div>
      {places.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Where</th><th className="num">Quantity</th></tr></thead>
          <tbody>{places.map((p) => <tr key={p.warehouseId}><td>{p.warehouseId ? store.titleOf('warehouses', p.warehouseId) : <span className="muted">Not in a warehouse</span>}</td><td className="num">{n(p.qty)}</td></tr>)}</tbody>
        </table></div>
      )}
      <h3 className="settings-sub">Latest stock entries</h3>
      {moves.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Date</th><th>Reason</th><th className="num">Qty</th><th>Reference</th></tr></thead>
          <tbody>{moves.map((m) => (
            <tr key={m.id}><td>{formatDate(String(m.date))}</td><td>{String(m.reason || (m.direction === 'Out' ? 'Out' : 'In'))}</td>
              <td className={'num ' + (m.direction === 'Out' ? 'bad-text' : 'good-text')}>{m.direction === 'Out' ? '−' : '+'}{n(Number(m.qty) || 0)}</td>
              <td><Link to={`/m/stockMoves/${m.id}`}>{String(m.reference || m.number || 'Entry')}</Link></td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted">No stock entries yet. Stock comes in with purchase orders (“Receive goods”) or a count.</p>}
      {dialog === 'count' && <CountDialog product={product} onClose={() => setDialog(null)} onDone={(d) => toast(d ? `Stock ${d > 0 ? 'increased' : 'reduced'} by ${n(Math.abs(d))}` : 'The count matches the books — nothing to change')} />}
      {dialog === 'move' && <MoveDialog product={product} onClose={() => setDialog(null)} onDone={() => toast('Stock moved')} />}
    </div>
  );
}

function CountDialog({ product, onClose, onDone }: { product: Rec; onClose: () => void; onDone: (diff: number) => void }) {
  const store = useStore();
  const dlg = useDialogFocus(true, onClose);
  const { toast } = useFeedback();
  const [wh, setWh] = useState('');
  const booked = wh ? (store.stockByWarehouse(product.id).find((x) => x.warehouseId === wh)?.qty || 0) : store.stockOf(product.id);
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('Count correction');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { onDone(await store.adjustStock(product.id, Number(counted), { warehouseId: wh, reason, note })); onClose(); }
    catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };
  return (
    <div className="modal-back">
      <div ref={dlg} className="modal" role="dialog" aria-modal="true" aria-labelledby="cnt-title">
        <h2 id="cnt-title">Count / adjust — {String(product.name)}</h2>
        <p className="muted small">Enter what is physically there. The difference from the books ({n(booked)}) is saved as one stock entry with its reason.</p>
        <div className="form-grid">
          {store.all('warehouses').length > 0 && <WarehouseSelect value={wh} onChange={setWh} label="Where you counted" allowNone="Everywhere (all stock)" />}
          <label className="field"><span>Counted quantity</span><input className="input" type="number" min={0} step="any" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus /></label>
          <label className="field"><span>Reason</span><select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            {STOCK_REASONS.filter((r) => ['Opening stock', 'Count correction', 'Damage / scrap', 'Other'].includes(r)).map((r) => <option key={r}>{r}</option>)}</select></label>
          <label className="field"><span>Note</span><input className="input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="e.g. yearly count, 2 panels cracked" /></label>
        </div>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || counted === ''}>Save count</button>
        </div>
      </div>
    </div>
  );
}

function MoveDialog({ product, onClose, onDone }: { product: Rec; onClose: () => void; onDone: () => void }) {
  const store = useStore();
  const dlg = useDialogFocus(true, onClose);
  const { toast } = useFeedback();
  const places = store.stockByWarehouse(product.id).filter((p) => p.qty > 0);
  const [from, setFrom] = useState(places[0]?.warehouseId ?? '');
  const [to, setTo] = useState(store.all('warehouses').find((w) => w.id !== (places[0]?.warehouseId ?? ''))?.id || '');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await store.transferStock(product.id, Number(qty), from, to); onDone(); onClose(); }
    catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };
  return (
    <div className="modal-back">
      <div ref={dlg} className="modal" role="dialog" aria-modal="true" aria-labelledby="mv-title">
        <h2 id="mv-title">Move between warehouses — {String(product.name)}</h2>
        <div className="form-grid">
          <label className="field"><span>From</span><select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            {places.map((p) => <option key={p.warehouseId} value={p.warehouseId}>{p.warehouseId ? store.titleOf('warehouses', p.warehouseId) : 'Not in a warehouse'} ({n(p.qty)})</option>)}</select></label>
          <WarehouseSelect value={to} onChange={setTo} label="To" />
          <label className="field"><span>Quantity</span><input className="input" type="number" min={0} step="any" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        </div>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || !qty || !to}>Move stock</button>
        </div>
      </div>
    </div>
  );
}
