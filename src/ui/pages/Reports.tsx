import { useMemo, useState } from 'react';
import { useStore } from '../../lib/store';
import { canRead } from '../../lib/rbac';
import { money, round2 } from '../../lib/money';
import { addDaysIso, localDateOf, todayIso } from '../../lib/format';
import type { Cell, ColType, ExportTable } from '../../lib/exporters';
import { ExportMenu } from '../components/ExportMenu';
import { tracksStock } from '../../lib/store/stock';
import { formatDate } from '../../lib/format';
import { Bars } from '../components/Bars';
import { ChartCard } from '../components/Charts';
import { monthLabel } from '../components/Views';
import { Icon } from '../components/Icon';
import { computeTotals, hsnSummary, lineAmount } from '../../lib/money';
import { qtyByProduct, receivedOf } from '../../lib/store/stock';
import type { LineItem } from '../../lib/schema';

/** GST unit quantity code for the HSN summary: services (SAC 99…) have none; unknown units are "OTH". */
function uqcOf(unit: string, hsn: string): string {
  if (/^99/.test(hsn)) return 'NA';
  return ({ Nos: 'NOS', Meter: 'MTR', Kg: 'KGS', Set: 'SET' } as Record<string, string>)[unit] || 'OTH';
}

/** Days between two ISO dates (b − a). */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const AGE = ['Not yet due', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days'];

export function ageBucket(dueDate: string, today: string): number {
  if (!dueDate || dueDate >= today) return 0;
  const d = daysBetween(dueDate, today);
  return d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
}

export function Reports() {
  const store = useStore();
  const [from, setFrom] = useState(addDaysIso(todayIso(), -90));
  const [to, setTo] = useState(todayIso());
  const valid = !!from && !!to && from <= to;
  const inRange = (d: unknown) => valid && String(d || '').slice(0, 10) >= from && String(d || '').slice(0, 10) <= to;

  // "Label:type" columns; the period and company go on PDFs.
  const table = (title: string, cols: string[], rows: Cell[][], dated = true): ExportTable => ({
    title, company: String(store.settings().companyName || ''),
    subtitle: dated ? `${formatDate(from)} to ${formatDate(to)} · ${rows.length} row(s)` : `As on ${formatDate(todayIso())} · ${rows.length} row(s)`,
    columns: cols.map((c) => { const [label, type] = c.split(':'); return { label, type: (type || 'text') as ColType }; }),
    rows,
  });

  const data = useMemo(() => {
    const invoices = store.all('invoices').filter((i) => i.status !== 'Cancelled' && i.status !== 'Draft' && inRange(i.date));
    const payments = store.all('payments').filter((p) => inRange(p.date));
    const expenses = store.all('expenses').filter((e) => inRange(e.date));
    const supplierPays = store.all('supplierPayments').filter((p) => inRange(p.date));

    const months = new Map<string, { invoiced: number; collected: number; expenses: number; suppliers: number }>();
    const bucket = (d: unknown) => {
      const k = String(d).slice(0, 7);
      if (!months.has(k)) months.set(k, { invoiced: 0, collected: 0, expenses: 0, suppliers: 0 });
      return months.get(k)!;
    };
    for (const i of invoices) bucket(i.date).invoiced += store.computed('invoices', i).grandTotal;
    for (const p of payments) bucket(p.date).collected += Number(p.amount) || 0;
    for (const e of expenses) bucket(e.date).expenses += Number(e.amount) || 0;
    for (const p of supplierPays) bucket(p.date).suppliers += Number(p.amount) || 0;
    const monthly = [...months.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([m, v]) => ({ month: m, invoiced: round2(v.invoiced), collected: round2(v.collected), expenses: round2(v.expenses), suppliers: round2(v.suppliers) }));

    let taxable = 0, cgst = 0, sgst = 0, igst = 0;
    const gstRows = invoices.map((i) => {
      const t = store.totalsFor('invoices', i);
      taxable += t.taxable; cgst += t.cgst; sgst += t.sgst; igst += t.igst;
      const c = store.get('customers', i.customerId);
      return [i.number, i.date, c?.name || '', c?.gstin || '', t.taxable, t.cgst, t.sgst, t.igst, t.grandTotal];
    });

    const leads = store.all('leads').filter((l) => inRange(localDateOf(l.createdAt)));
    const sources = new Map<string, { total: number; won: number }>();
    for (const l of leads) {
      const s = String(l.source || 'Unknown');
      const v = sources.get(s) || { total: 0, won: 0 };
      v.total++; if (l.status === 'Won') v.won++;
      sources.set(s, v);
    }
    const expCat = new Map<string, number>();
    for (const e of expenses) expCat.set(String(e.category || 'Other'), (expCat.get(String(e.category || 'Other')) || 0) + (Number(e.amount) || 0));

    // Purchases (input GST): only goods that have actually arrived on orders dated in the range — an order that is
    // only placed has no tax invoice yet. Part deliveries count for what came; other lines when the order is complete.
    const pos = store.all('purchaseOrders').filter((o) => ['Received', 'Partially Received'].includes(String(o.status)) && inRange(o.date));
    let pTaxable = 0, pTax = 0;
    const purchaseRows = pos.flatMap((o) => {
      const got = receivedOf(o), ordered = qtyByProduct(o.items), full = o.status === 'Received';
      const items = ((o.items as LineItem[]) || []).filter(Boolean).map((it) => {
        if (it.productId && tracksStock(store.get('products', it.productId)) && !full) {
          const share = Math.min(1, (Number(got[it.productId]) || 0) / (ordered.get(it.productId) || 1));
          return { ...it, qty: round2((Number(it.qty) || 0) * share) };
        }
        return full ? it : { ...it, qty: 0 };
      });
      const all = store.totalsFor('purchaseOrders', o);
      const sub = computeTotals(items).subtotal;
      const t = computeTotals(items, all.subtotal > 0 ? (Number(o.discount) || 0) * (sub / all.subtotal) : 0, !!o.interState);
      if (t.taxable <= 0) return [];
      pTaxable += t.taxable; pTax += t.tax;
      const v = store.get('vendors', o.vendorId);
      return [[o.number, o.date, v?.name || '', v?.gstin || '', t.taxable, t.cgst, t.sgst, t.igst, t.grandTotal, o.status]];
    });

    // HSN-wise and product-wise sales.
    // GSTR-1 HSN summary: per B2B/B2C, HSN and rate, with quantity in the official unit code and each tax.
    const hsn = new Map<string, { type: string; hsn: string; uqc: string; rate: number; qty: number; taxable: number; igst: number; cgst: number; sgst: number; tax: number }>();
    const prod = new Map<string, { name: string; qty: number; taxable: number }>();
    for (const i of invoices) {
      const type = store.get('customers', i.customerId)?.gstin ? 'B2B' : 'B2C';
      const inter = typeof i.interState === 'boolean' ? i.interState : store.interStateFor(i);
      for (const h of hsnSummary(i.items as LineItem[], Number(i.discount) || 0, inter)) {
        const uqc = uqcOf(h.unit, h.hsn);
        const k = `${type}|${h.hsn}|${h.gstRate}|${uqc}`;
        const row = hsn.get(k) || { type, hsn: h.hsn, uqc, rate: h.gstRate, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, tax: 0 };
        row.qty += h.qty; row.taxable += h.taxable; row.igst += h.igst; row.cgst += h.cgst; row.sgst += h.sgst; row.tax += h.tax;
        hsn.set(k, row);
      }
      const t = store.totalsFor('invoices', i);
      const ratio = t.subtotal > 0 ? t.taxable / t.subtotal : 1;
      for (const it of (i.items as LineItem[]) || []) {
        if (!it) continue;
        const k = it.productId && store.get('products', it.productId) ? it.productId : `custom:${it.description}`;
        const row = prod.get(k) || { name: it.productId ? store.titleOf('products', it.productId) : String(it.description || 'Custom item'), qty: 0, taxable: 0 };
        row.qty += Number(it.qty) || 0; row.taxable += lineAmount(it) * ratio; prod.set(k, row);
      }
    }

    // Receivables ageing as of today (all open invoices, not just this range).
    const today = todayIso();
    const ageing = new Map<string, number[]>();
    for (const i of store.all('invoices').filter((x) => !['Cancelled', 'Draft'].includes(String(x.status)))) {
      const bal = store.computed('invoices', i).balance;
      if (bal <= 0.005) continue;
      const k = String(i.customerId);
      const row = ageing.get(k) || [0, 0, 0, 0, 0];
      row[ageBucket(String(i.dueDate || i.date || ''), today)] += bal;
      ageing.set(k, row);
    }

    // Stock valuation at purchase cost.
    // Valued at the moving average of what the stock actually cost (the product's cost when none was recorded).
    const stock = store.all('products').filter((p) => tracksStock(p)).map((p) => {
      const v = store.stockValuation(p.id), qty = store.stockOf(p.id);
      return { id: p.id, name: String(p.name), sku: String(p.sku || ''), qty, cost: v.avg, value: v.value, low: (Number(p.reorderLevel) || 0) > 0 && qty <= Number(p.reorderLevel) };
    }).sort((a, b) => b.value - a.value);

    return {
      purchaseRows, purchase: { taxable: round2(pTaxable), tax: round2(pTax) },
      hsnRows: [...hsn.values()].map((h) => ({ ...h, qty: round2(h.qty), taxable: round2(h.taxable), igst: round2(h.igst), cgst: round2(h.cgst), sgst: round2(h.sgst), tax: round2(h.tax) }))
        .sort((a, b) => a.type.localeCompare(b.type) || b.taxable - a.taxable),
      prodRows: [...prod.values()].map((x) => ({ ...x, qty: round2(x.qty), taxable: round2(x.taxable) })).sort((a, b) => b.taxable - a.taxable),
      ageing: [...ageing.entries()].map(([id, b]) => ({ id, name: store.titleOf('customers', id), b: b.map(round2), total: round2(b.reduce((x, y) => x + y, 0)) })).sort((a, b) => b.total - a.total),
      stock, stockValue: round2(stock.reduce((a, x) => a + x.value, 0)),
      monthly, gstRows,
      gst: { taxable: round2(taxable), cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst) },
      sources: [...sources.entries()].sort((a, b) => b[1].total - a[1].total),
      expCat: [...expCat.entries()].map(([name, value]) => ({ name, value: round2(value) })).sort((a, b) => b.value - a.value),
      totals: {
        invoiced: round2(monthly.reduce((s, m) => s + m.invoiced, 0)),
        collected: round2(monthly.reduce((s, m) => s + m.collected, 0)),
        expenses: round2(monthly.reduce((s, m) => s + m.expenses, 0)),
        suppliers: round2(monthly.reduce((s, m) => s + m.suppliers, 0)),
      },
    };
  }, [store, store.getVersion(), from, to]);

  const finance = canRead(store.user, 'finance');

  return (
    <>
      <div className="page-head">
        <h1>Reports</h1>
        <div className="spacer" />
        <button className="btn sm no-print" onClick={() => window.print()}><Icon name="print" size={16} />Print</button>
        <div className="toolbar" style={{ margin: 0 }}>
          <label className="small muted" htmlFor="r-from">From</label>
          <input id="r-from" className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ flex: '0 1 160px' }} />
          <label className="small muted" htmlFor="r-to">To</label>
          <input id="r-to" className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ flex: '0 1 160px' }} />
        </div>
      </div>
      {!valid && <div className="banner bad" role="alert">Choose a valid date range (From must be on or before To).</div>}

      {finance && (
        <div className="kpis">
          <div className="card kpi"><div className="label">Invoiced</div><div className="value">{money(data.totals.invoiced)}</div></div>
          <div className="card kpi"><div className="label">Collected</div><div className="value">{money(data.totals.collected)}</div></div>
          <div className="card kpi"><div className="label">Expenses</div><div className="value">{money(data.totals.expenses)}</div></div>
          <div className="card kpi"><div className="label">Paid to suppliers</div><div className="value">{money(data.totals.suppliers)}</div></div>
          <div className="card kpi"><div className="label">Net cash</div><div className="value">{money(round2(data.totals.collected - data.totals.expenses - data.totals.suppliers))}</div><div className="sub">collected − expenses − paid to suppliers</div></div>
        </div>
      )}

      <div className="grid grid-2">
        {finance && (
          <ChartCard title="Invoiced, collected and expenses by month" kinds={['bar', 'line']} format={money}
            data={{ labels: data.monthly.map((m) => monthLabel(m.month)), series: [
              { name: 'Invoiced', values: data.monthly.map((m) => m.invoiced) },
              { name: 'Collected', values: data.monthly.map((m) => m.collected) },
              { name: 'Expenses', values: data.monthly.map((m) => m.expenses) },
              { name: 'Paid to suppliers', values: data.monthly.map((m) => m.suppliers) },
            ] }} />
        )}
        {finance && (
          <div className="card">
            <h2>Collections by month</h2>
            <Bars data={data.monthly.map((m) => ({ name: monthLabel(m.month), value: m.collected }))} format={money} label="Amount collected each month" />
            <details style={{ marginTop: 12 }}>
              <summary className="small">Table: invoiced, collected and expenses by month</summary>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th>Month</th><th className="num">Invoiced</th><th className="num">Collected</th><th className="num">Expenses</th></tr></thead>
                  <tbody>{data.monthly.map((m) => <tr key={m.month}><td>{m.month}</td><td className="num">{money(m.invoiced)}</td><td className="num">{money(m.collected)}</td><td className="num">{money(m.expenses)}</td></tr>)}</tbody>
                </table>
              </div>
            </details>
          </div>
        )}
        {finance && (
          <div className="card">
            <h2>Expenses by category</h2>
            <Bars data={data.expCat} format={money} label="Expenses by category" />
          </div>
        )}
        {finance && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2>GST summary (sales)</h2>
              <ExportMenu disabled={!data.gstRows.length} name={`gst-sales-${from}-to-${to}`} build={() => table('GST summary (sales)', ['Invoice', 'Date:date', 'Customer', 'Customer GSTIN', 'Taxable:money', 'CGST:money', 'SGST:money', 'IGST:money', 'Total:money'], data.gstRows as Cell[][])} />
            </div>
            <div className="totals" style={{ marginLeft: 0, maxWidth: 'none' }}>
              <div><span>Invoices</span><span>{data.gstRows.length}</span></div>
              <div><span>Taxable value</span><span>{money(data.gst.taxable)}</span></div>
              <div><span>CGST</span><span>{money(data.gst.cgst)}</span></div>
              <div><span>SGST</span><span>{money(data.gst.sgst)}</span></div>
              <div><span>IGST</span><span>{money(data.gst.igst)}</span></div>
            </div>
            <p className="muted small">Draft and cancelled invoices are excluded. Verify with your CA before filing.</p>
          </div>
        )}
        {finance && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2>GST on purchases (input tax)</h2>
              <ExportMenu disabled={!data.purchaseRows.length} name={`gst-purchases-${from}-to-${to}`} build={() => table('GST on purchases', ['PO', 'Date:date', 'Vendor', 'Vendor GSTIN', 'Taxable:money', 'CGST:money', 'SGST:money', 'IGST:money', 'Total:money', 'Status'], data.purchaseRows as Cell[][])} />
            </div>
            <div className="totals" style={{ marginLeft: 0, maxWidth: 'none' }}>
              <div><span>Purchase orders</span><span>{data.purchaseRows.length}</span></div>
              <div><span>Taxable value</span><span>{money(data.purchase.taxable)}</span></div>
              <div><span>GST paid on purchases</span><span>{money(data.purchase.tax)}</span></div>
              <div><span>GST collected on sales</span><span>{money(round2(data.gst.cgst + data.gst.sgst + data.gst.igst))}</span></div>
              <div className="grand"><span>Indicative net GST</span><span>{money(round2(data.gst.cgst + data.gst.sgst + data.gst.igst - data.purchase.tax))}</span></div>
            </div>
            <p className="muted small">Based on purchase orders. Input credit is only available on vendor tax invoices reflected in GSTR-2B — confirm with your CA.</p>
          </div>
        )}
        {finance && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2>HSN-wise sales summary</h2>
              <ExportMenu disabled={!data.hsnRows.length} name={`hsn-summary-${from}-to-${to}`} build={() => table('HSN-wise sales summary', ['Type', 'HSN/SAC', 'UQC', 'Quantity:number', 'GST %:number', 'Taxable value:money', 'IGST:money', 'CGST:money', 'SGST:money', 'Total tax:money'], data.hsnRows.map((h) => [h.type, h.hsn, h.uqc, h.qty, h.rate, h.taxable, h.igst, h.cgst, h.sgst, h.tax]))} />
            </div>
            {data.hsnRows.length ? (
              <div className="table-wrap" tabIndex={0} role="region" aria-label="HSN-wise sales summary table"><table>
                <thead><tr><th>Type</th><th>HSN/SAC</th><th>UQC</th><th className="num">Qty</th><th className="num">GST %</th><th className="num">Taxable</th><th className="num">IGST</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">Total tax</th></tr></thead>
                <tbody>{data.hsnRows.map((h) => <tr key={h.type + h.hsn + h.rate + h.uqc}><td>{h.type}</td><td>{h.hsn}</td><td>{h.uqc}</td><td className="num">{h.qty}</td><td className="num">{h.rate}%</td><td className="num">{money(h.taxable)}</td><td className="num">{money(h.igst)}</td><td className="num">{money(h.cgst)}</td><td className="num">{money(h.sgst)}</td><td className="num">{money(h.tax)}</td></tr>)}</tbody>
              </table></div>
            ) : <p className="muted">No issued invoices in this period.</p>}
          </div>
        )}
        {finance && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2>Receivables ageing (today)</h2>
              <ExportMenu disabled={!data.ageing.length} name={`receivables-ageing-${todayIso()}`} build={() => table('Receivables ageing', ['Customer', ...AGE.map((a) => `${a}:money`), 'Total:money'], data.ageing.map((a) => [a.name, ...a.b, a.total]), false)} />
            </div>
            {data.ageing.length ? (
              <div className="table-wrap"><table>
                <thead><tr><th>Customer</th>{AGE.map((a) => <th key={a} className="num">{a}</th>)}<th className="num">Total</th></tr></thead>
                <tbody>{data.ageing.map((a) => <tr key={a.id}><td>{a.name}</td>{a.b.map((v, i) => <td key={i} className="num">{v ? money(v) : ''}</td>)}<td className="num"><strong>{money(a.total)}</strong></td></tr>)}</tbody>
              </table></div>
            ) : <p className="muted">Nothing outstanding.</p>}
          </div>
        )}
        {finance && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2>Product-wise sales</h2>
              <ExportMenu disabled={!data.prodRows.length} name={`product-sales-${from}-to-${to}`} build={() => table('Product-wise sales', ['Product', 'Quantity:number', 'Taxable value:money'], data.prodRows.map((x) => [x.name, x.qty, x.taxable]))} />
            </div>
            <Bars data={data.prodRows.slice(0, 10).map((x) => ({ name: x.name, value: x.taxable }))} format={money} label="Top products by taxable sales" />
          </div>
        )}
        {canRead(store.user, 'inventory') && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2>Stock valuation (at cost) · {money(data.stockValue)}</h2>
              <ExportMenu disabled={!data.stock.length} name={`stock-valuation-${todayIso()}`} build={() => table('Stock valuation (at cost)', ['Product', 'SKU', 'In stock:number', 'Cost:money', 'Value:money', 'Low stock'], data.stock.map((x) => [x.name, x.sku, x.qty, x.cost, x.value, x.low ? 'Yes' : '']), false)} />
            </div>
            {data.stock.length ? (
              <div className="table-wrap"><table>
                <thead><tr><th>Product</th><th className="num">In stock</th><th className="num">Cost</th><th className="num">Value</th></tr></thead>
                <tbody>{data.stock.slice(0, 50).map((x) => <tr key={x.id}><td>{x.name}{x.low && <span className="badge bad" style={{ marginLeft: 6 }}>Low</span>}</td><td className="num">{x.qty}</td><td className="num">{money(x.cost)}</td><td className="num">{money(x.value)}</td></tr>)}</tbody>
              </table></div>
            ) : <p className="muted">No stocked products yet.</p>}
          </div>
        )}
        {canRead(store.user, 'crm') && (
          <div className="card">
            <h2>Lead sources</h2>
            {data.sources.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Source</th><th className="num">Leads</th><th className="num">Won</th><th className="num">Win rate</th></tr></thead>
                  <tbody>{data.sources.map(([s, v]) => <tr key={s}><td>{s}</td><td className="num">{v.total}</td><td className="num">{v.won}</td><td className="num">{Math.round((v.won / v.total) * 100)}%</td></tr>)}</tbody>
                </table>
              </div>
            ) : <p className="muted">No leads in this period.</p>}
          </div>
        )}
      </div>
    </>
  );
}
