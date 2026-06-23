import { BASE_URL, headers } from './helpers';

describe('Supplies Lookup API', () => {
  it('returns units', async () => {
    const res = await fetch(`${BASE_URL}/lookups/units`, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.units)).toBe(true);
    expect(data.units.length).toBeGreaterThan(0);
    expect(data.units[0]).toHaveProperty('value');
    expect(data.units[0]).toHaveProperty('label');
  });

  it('returns conditions, item types, issue types and wastage reasons', async () => {
    const res = await fetch(`${BASE_URL}/lookups/conditions`, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.conditions)).toBe(true);
    expect(data.itemTypes).toContain('consumable');
    expect(data.itemTypes).toContain('equipment');
    expect(Array.isArray(data.issueTypes)).toBe(true);
    expect(data.wastageReasons.map((r: any) => r.value)).toContain('expired');
  });
});
