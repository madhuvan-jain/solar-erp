import { describe, expect, it } from 'vitest';
import { productFromLine } from './QuickCreate';

describe('product from a document line', () => {
  it('copies what was typed, price for sales and cost for purchases', () => {
    const line = { description: ' Panel 545 Wp ', hsn: '8541', qty: 2, unit: 'Nos', rate: 14000, gstRate: 5 };
    expect(productFromLine(line, false)).toEqual({ name: 'Panel 545 Wp', hsn: '8541', unit: 'Nos', gstRate: '5', price: 14000 });
    expect(productFromLine(line, true)).toEqual({ name: 'Panel 545 Wp', hsn: '8541', unit: 'Nos', gstRate: '5', cost: 14000 });
  });

  it('leaves out units and GST rates the product form does not offer, and empty values', () => {
    const line = { description: '', qty: 1, unit: 'Pcs', rate: 0, gstRate: 7 };
    expect(productFromLine(line, false)).toEqual({});
    expect(productFromLine({ description: 'Cable', qty: 1, rate: 50, gstRate: NaN }, false)).toEqual({ name: 'Cable', price: 50 });
  });
});
