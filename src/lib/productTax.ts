// GST rate and HSN/SAC a solar installer's product usually has, by category (India, since 22 Sep 2025):
// solar PV modules and solar power devices (incl. their inverters) 5%; batteries, structures, cables, switchgear,
// meters and installation services 18%. Filled in as a starting point; the CA has the last word.
export const CATEGORY_TAX: Record<string, { gst: string; hsn: string }> = {
  'Solar Panel': { gst: '5', hsn: '8541' },
  Inverter: { gst: '5', hsn: '8504' },
  Battery: { gst: '18', hsn: '8507' },
  Structure: { gst: '18', hsn: '7308' },
  Cable: { gst: '18', hsn: '8544' },
  'BOS / Accessories': { gst: '18', hsn: '' },
  Service: { gst: '18', hsn: '9954' },
  Other: { gst: '18', hsn: '' },
};

/** GST for a product with no category yet, and for a typed (custom) line on a document. */
export const DEFAULT_GST = '18';

export const taxFor = (category: unknown) => CATEGORY_TAX[String(category || '')] || { gst: DEFAULT_GST, hsn: '' };

/**
 * When a product's category changes: the GST rate and HSN that still are what the old category suggested (or empty)
 * follow the new category; anything the user typed is left alone.
 */
export function categoryPatch(prevCategory: unknown, nextCategory: unknown, values: Record<string, unknown>): Record<string, unknown> {
  const was = taxFor(prevCategory), now = taxFor(nextCategory);
  const patch: Record<string, unknown> = {};
  const gst = String(values.gstRate ?? '');
  if (gst === '' || gst === was.gst) patch.gstRate = now.gst;
  const hsn = String(values.hsn ?? '').trim();
  if ((hsn === '' || hsn === was.hsn) && now.hsn) patch.hsn = now.hsn;
  else if (hsn !== '' && hsn === was.hsn && !now.hsn) patch.hsn = '';
  return patch;
}
