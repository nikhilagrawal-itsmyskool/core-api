import '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';
import { createTestSchool, cleanupTestSchool, TestSchool } from './test-school';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Uniform Purchase API', () => {
  let school: TestSchool;
  let headers: Record<string, string>;
  const itemsUrl = `${BASE_URL}/items`;
  const purchasesUrl = `${BASE_URL}/purchases`;

  let testItemId: string;
  let testSizeId: string;
  let createdBatchId: string;

  beforeAll(async () => {
    school = await createTestSchool();
    headers = { 'Content-Type': 'application/json', 'X-School-Code': school.schoolCode };

    // Create item + size for purchase tests
    const itemRes = await fetch(itemsUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'Test Pant', category: 'summer', gender: 'male' }),
    });
    testItemId = (await itemRes.json()).uuid;

    const sizeRes = await fetch(`${itemsUrl}/${testItemId}/sizes`, {
      method: 'POST', headers,
      body: JSON.stringify({ sizeLabel: '30' }),
    });
    testSizeId = (await sizeRes.json()).uuid;
  });

  afterAll(async () => {
    await cleanupTestSchool(school);
  });

  describe('POST /uniform/purchases', () => {
    it('should create a purchase batch and update stock', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          purchaseDate: '2026-01-15',
          supplier: 'ABC Textiles',
          invoiceNumber: 'INV-001',
          notes: 'Initial stock',
          items: [{ itemId: testItemId, sizeId: testSizeId, quantity: 50, mrp: 600, studentDiscountPct: 10, bulkDiscountPct: 5 }],
        }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.supplier).toBe('ABC Textiles');
      expect(data.invoiceNumber).toBe('INV-001');
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items[0].quantity).toBe(50);
      createdBatchId = data.uuid;

      // Verify stock updated
      const itemsRes = await fetch(itemsUrl, { method: 'GET', headers });
      const items = await itemsRes.json();
      const size = items.find((i: any) => i.uuid === testItemId)?.sizes?.find((s: any) => s.uuid === testSizeId);
      expect(size?.currentStock).toBe(50);
    });

    it('should return 400 for missing purchaseDate', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ supplier: 'Test', items: [{ itemId: testItemId, sizeId: testSizeId, quantity: 10 }] }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for empty items array', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ purchaseDate: '2026-01-15', items: [] }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid sizeId', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          purchaseDate: '2026-01-15',
          items: [{ itemId: testItemId, sizeId: 'nonexistent1', quantity: 10 }],
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for quantity < 1', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          purchaseDate: '2026-01-15',
          items: [{ itemId: testItemId, sizeId: testSizeId, quantity: 0 }],
        }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /uniform/purchases', () => {
    it('should list purchase batches', async () => {
      const response = await fetch(purchasesUrl, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should filter by supplier', async () => {
      const response = await fetch(`${purchasesUrl}?supplier=ABC+Textiles`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /uniform/purchases/{id}', () => {
    it('should get purchase batch by ID with item details', async () => {
      const response = await fetch(`${purchasesUrl}/${createdBatchId}`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdBatchId);
      expect(data.supplier).toBe('ABC Textiles');
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items[0].itemName).toBeDefined();
      expect(data.items[0].sizeLabel).toBe('30');
    });

    it('should return 404 for non-existent batch', async () => {
      const response = await fetch(`${purchasesUrl}/nonexistent1`, { method: 'GET', headers });
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /uniform/purchases/{id}', () => {
    it('should delete batch and reverse stock', async () => {
      // Create a separate batch to delete
      const createRes = await fetch(purchasesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          purchaseDate: '2026-01-20',
          items: [{ itemId: testItemId, sizeId: testSizeId, quantity: 20, mrp: 600 }],
        }),
      });
      const batch = await createRes.json();

      // Stock should now be 50 + 20 = 70
      const before = await fetch(itemsUrl, { method: 'GET', headers });
      const beforeItems = await before.json();
      const sizeBefore = beforeItems.find((i: any) => i.uuid === testItemId)?.sizes?.find((s: any) => s.uuid === testSizeId);
      expect(sizeBefore?.currentStock).toBe(70);

      // Delete the batch
      const deleteRes = await fetch(`${purchasesUrl}/${batch.uuid}`, { method: 'DELETE', headers });
      expect(deleteRes.status).toBe(200);
      expect(await deleteRes.json()).toHaveProperty('message');

      // Stock should be back to 50
      const after = await fetch(itemsUrl, { method: 'GET', headers });
      const afterItems = await after.json();
      const sizeAfter = afterItems.find((i: any) => i.uuid === testItemId)?.sizes?.find((s: any) => s.uuid === testSizeId);
      expect(sizeAfter?.currentStock).toBe(50);
    });

    it('should return 404 for deleting non-existent batch', async () => {
      const response = await fetch(`${purchasesUrl}/nonexistent1`, { method: 'DELETE', headers });
      expect(response.status).toBe(404);
    });
  });
});
