import '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';
import { createTestSchool, cleanupTestSchool, TestSchool } from './test-school';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

// Covers the "judge the number at the counter" flow: unsized items, per-item price
// bands, price suggestion, an unsized sale, and breaking the pool into numbers.
describe('Uniform Unsized Items + Price Bands + Break', () => {
  let school: TestSchool;
  let headers: Record<string, string>;
  const itemsUrl = `${BASE_URL}/items`;
  const purchasesUrl = `${BASE_URL}/purchases`;
  const salesUrl = `${BASE_URL}/sales`;

  let itemId: string;
  let poolSizeId: string;

  const getItem = async (id: string) => {
    const res = await fetch(itemsUrl, { method: 'GET', headers });
    const items = await res.json();
    return items.find((i: any) => i.uuid === id);
  };

  beforeAll(async () => {
    school = await createTestSchool();
    headers = { 'Content-Type': 'application/json', 'X-School-Code': school.schoolCode };
  });

  afterAll(async () => {
    await cleanupTestSchool(school);
  });

  describe('POST /uniform/items (unsized)', () => {
    it('creates an unsized item with a single pool stock row', async () => {
      const res = await fetch(itemsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ name: 'Tailor Shirt', category: 'summer', gender: 'unisex', sizingMode: 'unsized' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sizingMode).toBe('unsized');
      itemId = data.uuid;

      const item = await getItem(itemId);
      expect(Array.isArray(item.sizes)).toBe(true);
      expect(item.sizes).toHaveLength(1);
      expect(item.sizes[0].isPool).toBe(true);
      poolSizeId = item.sizes[0].uuid;
      expect(Array.isArray(item.bands)).toBe(true);
    });

    it('rejects an invalid sizingMode', async () => {
      const res = await fetch(itemsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ name: 'Bad', category: 'summer', gender: 'unisex', sizingMode: 'nonsense' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Price bands', () => {
    it('creates number->price bands', async () => {
      const b1 = await fetch(`${itemsUrl}/${itemId}/bands`, {
        method: 'POST', headers,
        body: JSON.stringify({ numberFrom: 20, numberTo: 24, mrp: 250, studentDiscountPct: 10, bulkDiscountPct: 5, sortOrder: 1 }),
      });
      expect(b1.status).toBe(200);
      const b2 = await fetch(`${itemsUrl}/${itemId}/bands`, {
        method: 'POST', headers,
        body: JSON.stringify({ numberFrom: 26, numberTo: 32, mrp: 300, studentDiscountPct: 10, bulkDiscountPct: 5, sortOrder: 2 }),
      });
      expect(b2.status).toBe(200);

      const item = await getItem(itemId);
      expect(item.bands).toHaveLength(2);
    });

    it('rejects numberFrom > numberTo', async () => {
      const res = await fetch(`${itemsUrl}/${itemId}/bands`, {
        method: 'POST', headers,
        body: JSON.stringify({ numberFrom: 40, numberTo: 30, mrp: 100 }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /uniform/items/{id}/suggest-price', () => {
    it('suggests the covering band price for a judged number', async () => {
      const res = await fetch(`${itemsUrl}/${itemId}/suggest-price?number=28`, { method: 'GET', headers });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.matched).toBe(true);
      expect(data.mrp).toBe(300);
      expect(data.number).toBe(28);
    });

    it('returns matched=false for a number no band covers', async () => {
      const res = await fetch(`${itemsUrl}/${itemId}/suggest-price?number=99`, { method: 'GET', headers });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.matched).toBe(false);
      expect(data.mrp).toBeNull();
    });

    it('400 when number param is missing', async () => {
      const res = await fetch(`${itemsUrl}/${itemId}/suggest-price`, { method: 'GET', headers });
      expect(res.status).toBe(400);
    });
  });

  describe('Unsized sale prices from the band', () => {
    beforeAll(async () => {
      // Stock the pool with 50 units.
      await fetch(purchasesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          purchaseDate: '2026-01-10',
          items: [{ itemId, sizeId: poolSizeId, quantity: 50, mrp: 0 }],
        }),
      });
    });

    it('prices an unsized line from the judged number and records judgedSize', async () => {
      const res = await fetch(salesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          studentId: school.studentId,
          saleDate: '2026-02-01',
          saleType: 'student',
          amountPaid: 270,
          items: [{ itemId, sizeId: poolSizeId, quantity: 1, judgedSize: '28' }],
        }),
      });
      expect(res.status).toBe(200);
      const sale = await res.json();
      expect(sale.totalMrp).toBe(300);       // band mrp for 28
      expect(sale.totalDiscount).toBe(30);   // 10%
      expect(sale.totalAmount).toBe(270);

      const detail = await (await fetch(`${salesUrl}/${sale.uuid}`, { method: 'GET', headers })).json();
      expect(detail.items[0].judgedSize).toBe('28');

      // Pool stock reduced 50 -> 49
      const item = await getItem(itemId);
      expect(item.sizes.find((s: any) => s.isPool).currentStock).toBe(49);
    });
  });

  describe('POST /uniform/items/{id}/break-sizes', () => {
    it('rejects a breakdown whose total != pool stock', async () => {
      const res = await fetch(`${itemsUrl}/${itemId}/break-sizes`, {
        method: 'POST', headers,
        body: JSON.stringify({ breakdown: [{ sizeLabel: '28', quantity: 10 }] }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.description).toMatch(/equal pool stock/i);
    });

    it('converts the pool into sized rows and flips the item to sized', async () => {
      // Pool currently holds 49.
      const res = await fetch(`${itemsUrl}/${itemId}/break-sizes`, {
        method: 'POST', headers,
        body: JSON.stringify({
          breakdown: [
            { sizeLabel: '22', quantity: 14 },
            { sizeLabel: '28', quantity: 20 },
            { sizeLabel: '30', quantity: 15 },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sizingMode).toBe('sized');

      const sizes = data.sizes.filter((s: any) => !s.isPool);
      expect(sizes.map((s: any) => s.sizeLabel).sort()).toEqual(['22', '28', '30']);
      // No pool row remains active.
      expect(data.sizes.find((s: any) => s.isPool)).toBeUndefined();
      // Size 28 inherited the band mrp (300).
      expect(sizes.find((s: any) => s.sizeLabel === '28').mrp).toBe(300);
      expect(sizes.find((s: any) => s.sizeLabel === '22').mrp).toBe(250);
      expect(sizes.find((s: any) => s.sizeLabel === '22').currentStock).toBe(14);
    });

    it('rejects breaking an already-sized item', async () => {
      const res = await fetch(`${itemsUrl}/${itemId}/break-sizes`, {
        method: 'POST', headers,
        body: JSON.stringify({ breakdown: [{ sizeLabel: '22', quantity: 1 }] }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.description).toMatch(/unsized/i);
    });
  });
});
