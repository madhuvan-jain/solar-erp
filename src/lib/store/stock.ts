// Stock rules that do not depend on the store: which products keep stock, what a document has
// received or issued, and what stock is worth (moving average of what it cost).
import type { LineItem, Rec } from '../schema';
import { lineAmount, round2 } from '../money';

/** Why a stock entry was made. Entries made by a purchase order or challan get their reason automatically. */
export const STOCK_REASONS = [
  'Opening stock', 'Purchase receipt', 'Delivery to site', 'Return from site', 'Count correction', 'Damage / scrap', 'Transfer', 'Sale (supply only)', 'Other',
];

/** Services and jobs (installation, commissioning…) are sold and bought but never kept in stock. */
export const tracksStock = (p: Rec | undefined): boolean =>
  !!p && !p.noStock && p.category !== 'Service' && p.unit !== 'Job';

/** Total quantity per product on a document's lines (a product may appear on several lines). */
export function qtyByProduct(items: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of (Array.isArray(items) ? items : []) as LineItem[]) {
    if (it && it.productId && Number(it.qty) > 0) out.set(it.productId, round2((out.get(it.productId) || 0) + Number(it.qty)));
  }
  return out;
}

/** Cost per unit on a purchase order, per product, after line discounts and before GST. */
export function unitCostByProduct(items: unknown): Map<string, number> {
  const amt = new Map<string, number>(), qty = new Map<string, number>();
  for (const it of (Array.isArray(items) ? items : []) as LineItem[]) {
    if (!it?.productId || !(Number(it.qty) > 0)) continue;
    amt.set(it.productId, (amt.get(it.productId) || 0) + lineAmount(it));
    qty.set(it.productId, (qty.get(it.productId) || 0) + Number(it.qty));
  }
  return new Map([...amt].map(([p, a]) => [p, round2(a / (qty.get(p) || 1))]));
}

/** What a purchase order has received so far. Orders received in full by older versions have no breakdown. */
export function receivedOf(po: Rec): Record<string, number> {
  if (po.received && typeof po.received === 'object') return po.received as Record<string, number>;
  return po.stockReceived ? Object.fromEntries(qtyByProduct(po.items)) : {};
}

/** Still to come on an order, per product. */
export function remainingOf(po: Rec): Map<string, number> {
  const got = receivedOf(po);
  const out = new Map<string, number>();
  for (const [p, q] of qtyByProduct(po.items)) { const left = round2(q - (Number(got[p]) || 0)); if (left > 0) out.set(p, left); }
  return out;
}

const order = (a: Rec, b: Rec) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

/**
 * Quantity, value and average cost of one product from its movements, in date order: receipts add at their
 * cost (or the product's cost when none was recorded), issues take stock out at the average cost at that time.
 */
export function valuation(moves: Rec[], fallbackCost: number): { qty: number; value: number; avg: number } {
  let qty = 0, value = 0, lastAvg = fallbackCost;
  const rateOf = (m: Rec) => { const r = Number(m.rate); return Number.isFinite(r) && r > 0 ? r : 0; };
  for (const m of moves.slice().sort(order)) {
    const q = Number(m.qty) || 0;
    if (m.direction === 'Out') {
      // At the running average; an issue dated before the receipt (stock briefly below zero by date) is kept, not lost.
      const avg = qty > 0.0001 ? value / qty : rateOf(m) || lastAvg;
      qty -= q; value -= q * avg;
    } else {
      qty += q; value += q * (rateOf(m) || fallbackCost);
    }
    if (Math.abs(qty) < 0.0001) { qty = 0; value = 0; } else if (qty > 0) lastAvg = value / qty;
  }
  return { qty: round2(qty), value: round2(Math.max(0, value)), avg: qty > 0 ? round2(value / qty) : round2(lastAvg) };
}
