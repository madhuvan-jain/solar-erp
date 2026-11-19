import { describe, expect, it } from 'vitest';
import { isPmSuryaGhar, pmSuryaGharSubsidy } from './subsidy';

describe('PM Surya Ghar subsidy', () => {
  it('follows the slabs: ₹30,000/kW up to 2 kW, ₹18,000 for the 3rd kW, max ₹78,000', () => {
    expect([1, 2, 2.5, 3, 5, 10].map((kw) => pmSuryaGharSubsidy(kw, 'Madhya Pradesh'))).toEqual([30000, 60000, 69000, 78000, 78000, 78000]);
    expect(pmSuryaGharSubsidy(0)).toBe(0);
    expect(pmSuryaGharSubsidy(Number.NaN)).toBe(0);
  });
  it('gives 10% more in special category states and UTs (max ₹85,800)', () => {
    expect(pmSuryaGharSubsidy(3, 'Assam')).toBe(85800);
    expect(pmSuryaGharSubsidy(1, 'jammu and kashmir')).toBe(33000);
    expect(pmSuryaGharSubsidy(3, 'Ladakh')).toBe(85800);
  });
  it('recognises the scheme name however it is typed', () => {
    expect(['PM Surya Ghar', 'pm suryaghar yojana', 'PM-Surya Ghar Muft Bijli'].every(isPmSuryaGhar)).toBe(true);
    expect(isPmSuryaGhar('State subsidy')).toBe(false);
  });
});
