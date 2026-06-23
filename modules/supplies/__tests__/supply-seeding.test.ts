import { BASE_URL, headers } from './helpers';

// Seeding is lazy (on first list of categories/items) and idempotent.
describe('Supplies Seeding', () => {
  it('seeds default categories on first category list', async () => {
    const res = await fetch(`${BASE_URL}/categories`, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.categories)).toBe(true);
    const codes = data.categories.map((c: any) => c.code);
    expect(codes).toContain('stationery');
    expect(codes).toContain('art_craft');
    expect(codes).toContain('cleaning');
  });

  it('seeds the curated item master', async () => {
    const res = await fetch(`${BASE_URL}/items`, { headers });
    expect(res.status).toBe(200);
    const items = await res.json();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(100);
  });

  it('is idempotent - re-listing does not duplicate the master', async () => {
    const first = await (await fetch(`${BASE_URL}/items`, { headers })).json();
    const second = await (await fetch(`${BASE_URL}/items`, { headers })).json();
    // Count of a known seeded item must stay at exactly one.
    const countCrayons = (arr: any[]) => arr.filter((i: any) => i.name === 'Wax Crayons').length;
    expect(countCrayons(first)).toBe(1);
    expect(countCrayons(second)).toBe(1);
  });
});
