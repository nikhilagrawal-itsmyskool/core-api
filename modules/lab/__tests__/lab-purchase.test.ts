import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Lab Purchase API', () => {
  const labsUrl = `${BASE_URL}/labs`;
  const itemsUrl = `${BASE_URL}/items`;
  const purchasesUrl = `${BASE_URL}/purchases`;

  let testLabId: string;
  let testItemId: string;
  let createdPurchaseId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  beforeAll(async () => {
    // Create test lab
    const labResponse = await fetch(labsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Test Lab for Purchases', type: 'chemistry' }),
    });
    const labData = await labResponse.json();
    testLabId = labData.uuid;

    // Create test item
    const itemResponse = await fetch(itemsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        labId: testLabId,
        name: 'Test Beaker 250ml',
        itemType: 'equipment',
        unit: 'piece',
        category: 'Glassware',
        reorderLevel: 10,
      }),
    });
    const itemData = await itemResponse.json();
    testItemId = itemData.uuid;
  });

  afterAll(async () => {
    if (testItemId) {
      await fetch(`${itemsUrl}/${testItemId}`, { method: 'DELETE', headers });
    }
    if (testLabId) {
      await fetch(`${labsUrl}/${testLabId}`, { method: 'DELETE', headers });
    }
  });

  describe('POST /lab/purchases', () => {
    it('should create a purchase and update stock', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          labId: testLabId,
          purchaseDate: '2026-01-15',
          quantity: 20,
          costPerUnit: 150.00,
          supplier: 'Lab Supplies Co.',
          invoiceNumber: 'INV-2026-001',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('uuid');
      expect(data.itemId).toBe(testItemId);
      expect(data.itemName).toBe('Test Beaker 250ml');
      expect(data.quantity).toBe(20);
      expect(data.status).toBe('active');

      createdPurchaseId = data.uuid;

      // Verify stock was updated
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(20);
    });

    it('should return 400 for missing itemId', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          labId: testLabId,
          purchaseDate: '2026-01-15',
          quantity: 10,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid itemId', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: 'nonexistent1',
          labId: testLabId,
          purchaseDate: '2026-01-15',
          quantity: 10,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid quantity', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          labId: testLabId,
          purchaseDate: '2026-01-15',
          quantity: 0,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /lab/purchases/{id}', () => {
    it('should get purchase by ID', async () => {
      const response = await fetch(`${purchasesUrl}/${createdPurchaseId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdPurchaseId);
      expect(data.itemName).toBe('Test Beaker 250ml');
    });

    it('should return 404 for non-existent purchase', async () => {
      const response = await fetch(`${purchasesUrl}/nonexistent1`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /lab/purchases', () => {
    it('should list purchases with date range', async () => {
      const response = await fetch(
        `${purchasesUrl}?labId=${testLabId}&startDate=2026-01-01&endDate=2026-12-31`,
        { method: 'GET', headers }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should return 400 for invalid date format', async () => {
      const response = await fetch(`${purchasesUrl}?startDate=invalid`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /lab/purchases/{id}', () => {
    it('should update purchase and adjust stock', async () => {
      const response = await fetch(`${purchasesUrl}/${createdPurchaseId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          quantity: 30,
          supplier: 'New Supplier',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.quantity).toBe(30);
      expect(data.supplier).toBe('New Supplier');

      // Verify stock was adjusted (20 -> 30, +10)
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(30);
    });
  });

  describe('DELETE /lab/purchases/{id}', () => {
    it('should delete purchase and reverse stock', async () => {
      const response = await fetch(`${purchasesUrl}/${createdPurchaseId}`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(200);

      // Verify stock was reversed (30 - 30 = 0)
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(0);
    });

    it('should return 404 for deleting non-existent purchase', async () => {
      const response = await fetch(`${purchasesUrl}/nonexistent1`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });
});
