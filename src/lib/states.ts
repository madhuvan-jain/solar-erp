/** GST state codes (first two digits of a GSTIN). */
export const STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

export const STATES = Object.values(STATE_CODES).sort();

/** GST state code of a state name, e.g. "Delhi" → "07". */
export function stateCode(name: unknown): string {
  const s = canonicalState(name);
  return s ? Object.keys(STATE_CODES).find((k) => STATE_CODES[k] === s) || '' : '';
}

/** "07 - Delhi": state name with its GST code, as tax invoices must show (CGST Rules, rule 46). */
export function stateWithCode(name: unknown): string {
  const s = canonicalState(name) || String(name || '').trim();
  const c = stateCode(s);
  return c ? `${c} - ${s}` : s;
}

export function stateFromGstin(gstin: unknown): string | undefined {
  const code = String(gstin || '').trim().slice(0, 2);
  return STATE_CODES[code];
}

/** Matches free text like " bihar " to the canonical state name. */
export function canonicalState(v: unknown): string | undefined {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return undefined;
  return STATES.find((x) => x.toLowerCase() === s);
}
