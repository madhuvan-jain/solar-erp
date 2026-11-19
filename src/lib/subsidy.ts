// PM Surya Ghar: Muft Bijli Yojana — central financial assistance (CFA) for a home's rooftop solar (MNRE, 2024):
// ₹30,000 per kW for the first 2 kW and ₹18,000 for the 3rd kW, so at most ₹78,000 (3 kW and above).
// Special category states and UTs get 10% more: ₹33,000 / ₹19,800 per kW, at most ₹85,800.
// Housing societies (RWA / GHS) get a different rate for common areas, so amounts above this are not refused.
import { canonicalState } from './states';

export const SPECIAL_CATEGORY_STATES = new Set([
  'Arunachal Pradesh', 'Assam', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Sikkim', 'Tripura',
  'Himachal Pradesh', 'Uttarakhand', 'Jammu and Kashmir', 'Ladakh', 'Andaman and Nicobar Islands', 'Lakshadweep',
]);

export const isPmSuryaGhar = (scheme: unknown) => /surya\s*ghar/i.test(String(scheme || ''));

/** The scheme's subsidy for a home system of `kw` kW in `state` (rupees, rounded). 0 when the size is unknown. */
export function pmSuryaGharSubsidy(kw: number, state?: unknown): number {
  if (!(kw > 0)) return 0;
  const special = SPECIAL_CATEGORY_STATES.has(canonicalState(state) || '');
  const base = Math.min(kw, 2) * 30000 + Math.min(Math.max(kw - 2, 0), 1) * 18000;
  return Math.round(base * (special ? 1.1 : 1));
}
