import { describe, expect, it } from 'vitest';
import { plusCode, shortPlusCode } from './plusCode';
import { loadTowns, whereIs } from './whereIs';

describe('photo location', () => {
  it('Plus Codes follow the open specification', () => {
    // Official test vectors (open-location-code test_data/encoding.csv).
    expect(plusCode(20.3700625, 2.7821875, 10)).toBe('7FG49QCJ+2V');
    expect(plusCode(20.3701125, 2.782234375, 11)).toBe('7FG49QCJ+2VX');
    expect(plusCode(47.0000625, 8.0000625, 10)).toBe('8FVC2222+22');
    expect(plusCode(-41.2730625, 174.7859375, 10)).toBe('4VCPPQGP+Q9');
    expect(plusCode(1, 1, 11)).toBe('6FH32222+222');
    expect(plusCode(1.2, 3.4, 10)).toBe('6FH56C22+22');
    expect(plusCode(-89.9999375, -179.9999375, 10)).toBe('22222222+22');
    // The sample photo's spot: same area code "6Q53" as the sample's "6q53+h69" (the last digits differ by one
    // 3-metre cell, as the sample app rounds its shown coordinates).
    expect(plusCode(25.20891, 78.753174).slice(4, 8)).toBe('6Q53');
    expect(shortPlusCode('7JQW6Q53+H77', 25.20891, 78.753174, 25.20837, 78.75158)).toBe('6Q53+H77');
  });

  it('names the town, district and state offline', async () => {
    await loadTowns();
    const p = whereIs(25.20891, 78.753174);
    expect(p).toMatchObject({ town: 'Pirthipur', district: 'Niwari', state: 'Madhya Pradesh' });
    expect(p.shortCode).toMatch(/^6Q53\+\w{3}, Pirthipur$/);
    expect(p.title).toBe('Pirthipur, Madhya Pradesh, India');
    expect(p.address).toBe(`${p.shortCode}, Niwari district, Madhya Pradesh`);
    const patna = whereIs(25.6093, 85.1376);
    expect(patna.town).toBe('Patna');
    expect(patna.state).toBe('Bihar');
  });
});
