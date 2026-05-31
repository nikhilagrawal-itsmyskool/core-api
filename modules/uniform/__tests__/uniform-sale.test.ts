import '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';
import { createTestSchool, cleanupTestSchool, TestSchool } from './test-school';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Uniform Sale API', () => {
  let school: TestSchool;
  let headers: Record<string, string>;
  const itemsUrl = `${BASE_URL}/items`;
  const purchasesUrl = `${BASE_URL}/purchases`;
  const salesUrl = `${BASE_URL}/sales`;

  let testItemId: string;
  let testSizeId: string;
  let createdSaleId: string;
  let createdSaleItemId: string;

  beforeAll(async () => {
    school = await createTestSchool();
    headers = { 'Content-Type': 'application/json', 'X-School-Code': school.schoolCode };

    // Create item
    const itemRes = await fetch(itemsUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'Sale Shirt', category: 'summer', gender: 'male' }),
    });
    testItemId = (await itemRes.json()).uuid;

    // Create size (label only — pricing comes from first purchase)
    const sizeRes = await fetch(`${itemsUrl}/${testItemId}/sizes`, {
      method: 'POST', headers,
      body: JSON.stringify({ sizeLabel: '40' }),
    });
    testSizeId = (await sizeRes.json()).uuid;

    // Purchase 100 units with MRP 500, 10% student discount, 5% bulk discount
    // This also sets the size's mrp/discounts for future sales
    await fetch(purchasesUrl, {
      method: 'POST', headers,
      body: JSON.stringify({
        purchaseDate: '2026-01-10',
        items: [{ itemId: testItemId, sizeId: testSizeId, quantity: 100, mrp: 500, studentDiscountPct: 10, bulkDiscountPct: 5 }],
      }),
    });
  });

  afterAll(async () => {
    await cleanupTestSchool(school);
  });

  describe('POST /uniform/sales', () => {
    it('should create a sale, compute totals and reduce stock', async () => {
      const response = await fetch(salesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          studentId: school.studentId,
          saleDate: '2026-02-01',
          saleType: 'student',
          amountPaid: 450,
          notes: 'Test sale',
          items: [{ itemId: testItemId, sizeId: testSizeId, quantity: 1 }],
        }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.studentId).toBe(school.studentId);
      expect(data.saleType).toBe('student');
      expect(data.totalMrp).toBe(500);
      expect(data.totalDiscount).toBe(50);   // 10% of 500
      expect(data.totalAmount).toBe(450);    // 500 - 50
      expect(data.amountPaid).toBe(450);
      expect(data.paymentStatus).toBe('paid');
      createdSaleId = data.uuid;

      // Verify stock reduced
      const itemsRes = await fetch(itemsUrl, { method: 'GET', headers });
      const items = await itemsRes.json();
      const size = items.find((i: any) => i.uuid === testItemId)?.sizes?.find((s: any) => s.uuid === testSizeId);
      expect(size?.currentStock).toBe(99);
    });

    it('should set paymentStatus to partial when partially paid', async () => {
      const response = await fetch(salesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          studentId: school.studentId,
          saleDate: '2026-02-02',
          saleType: 'student',
          amountPaid: 200,
          items: [{ itemId: testItemId, sizeId: testSizeId, quantity: 1 }],
        }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.paymentStatus).toBe('partial');
      expect(data.amountPaid).toBe(200);
    });

    it('should set paymentStatus to due when nothing paid', async () => {
      const response = await fetch(salesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          studentId: school.studentId,
          saleDate: '2026-02-03',
          saleType: 'student',
          amountPaid: 0,
          items: [{ itemId: testItemId, sizeId: testSizeId, quantity: 1 }],
        }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).paymentStatus).toBe('due');
    });

    it('should return 400 for missing studentId', async () => {
      const response = await fetch(salesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          saleDate: '2026-02-01', saleType: 'student', amountPaid: 0,
          items: [{ itemId: testItemId, sizeId: testSizeId, quantity: 1 }],
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid saleType', async () => {
      const response = await fetch(salesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          studentId: school.studentId, saleDate: '2026-02-01', saleType: 'invalid',
          amountPaid: 0, items: [{ itemId: testItemId, sizeId: testSizeId, quantity: 1 }],
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for insufficient stock', async () => {
      const response = await fetch(salesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          studentId: school.studentId, saleDate: '2026-02-01', saleType: 'student',
          amountPaid: 0, items: [{ itemId: testItemId, sizeId: testSizeId, quantity: 9999 }],
        }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.description).toMatch(/Insufficient stock/i);
    });

    it('should return 400 for empty items array', async () => {
      const response = await fetch(salesUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          studentId: school.studentId, saleDate: '2026-02-01', saleType: 'student',
          amountPaid: 0, items: [],
        }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /uniform/sales', () => {
    it('should list sales', async () => {
      const response = await fetch(salesUrl, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should filter by paymentStatus=paid', async () => {
      const response = await fetch(`${salesUrl}?paymentStatus=paid`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach((s: any) => expect(s.paymentStatus).toBe('paid'));
    });

    it('should filter by studentId', async () => {
      const response = await fetch(`${salesUrl}?studentId=${school.studentId}`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach((s: any) => expect(s.studentId).toBe(school.studentId));
    });

    it('should return 400 for invalid paymentStatus', async () => {
      const response = await fetch(`${salesUrl}?paymentStatus=invalid`, { method: 'GET', headers });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /uniform/sales/{id}', () => {
    it('should get sale by ID with line items', async () => {
      const response = await fetch(`${salesUrl}/${createdSaleId}`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdSaleId);
      expect(data.studentId).toBe(school.studentId);
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items).toHaveLength(1);
      expect(data.items[0].mrp).toBe(500);
      expect(data.items[0].discountPct).toBe(10);
      expect(data.items[0].unitPrice).toBe(450);
      expect(data.items[0].lineTotal).toBe(450);
      createdSaleItemId = data.items[0].uuid;
    });

    it('should return 404 for non-existent sale', async () => {
      const response = await fetch(`${salesUrl}/nonexistent1`, { method: 'GET', headers });
      expect(response.status).toBe(404);
    });
  });

  describe('POST /uniform/sales/{id}/returns', () => {
    it('should process a return and restore stock', async () => {
      const stockBefore = await fetch(itemsUrl, { method: 'GET', headers });
      const sizeBefore = (await stockBefore.json()).find((i: any) => i.uuid === testItemId)?.sizes?.find((s: any) => s.uuid === testSizeId);
      const stockCountBefore = sizeBefore?.currentStock;

      const response = await fetch(`${salesUrl}/${createdSaleId}/returns`, {
        method: 'POST', headers,
        body: JSON.stringify({
          saleItemId: createdSaleItemId,
          returnDate: '2026-02-05',
          quantity: 1,
          reason: 'Wrong size',
        }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.quantity).toBe(1);

      // Verify stock restored
      const stockAfter = await fetch(itemsUrl, { method: 'GET', headers });
      const sizeAfter = (await stockAfter.json()).find((i: any) => i.uuid === testItemId)?.sizes?.find((s: any) => s.uuid === testSizeId);
      expect(sizeAfter?.currentStock).toBe(stockCountBefore + 1);
    });

    it('should return 400 when returning more than available', async () => {
      const response = await fetch(`${salesUrl}/${createdSaleId}/returns`, {
        method: 'POST', headers,
        body: JSON.stringify({
          saleItemId: createdSaleItemId,
          returnDate: '2026-02-06',
          quantity: 10,
          reason: 'Excess',
        }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error.description).toMatch(/Cannot return/i);
    });

    it('should return 400 for missing saleItemId', async () => {
      const response = await fetch(`${salesUrl}/${createdSaleId}/returns`, {
        method: 'POST', headers,
        body: JSON.stringify({ returnDate: '2026-02-05', quantity: 1 }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for missing returnDate', async () => {
      const response = await fetch(`${salesUrl}/${createdSaleId}/returns`, {
        method: 'POST', headers,
        body: JSON.stringify({ saleItemId: createdSaleItemId, quantity: 1 }),
      });
      expect(response.status).toBe(400);
    });
  });
});
