import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

// Load module config - use GATEWAY_PORT env var if set, otherwise use module port
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Medical Purchase API', () => {
  const itemsUrl = `${BASE_URL}/items`;
  const purchasesUrl = `${BASE_URL}/purchases`;

  let testItemId: string;
  let createdPurchaseId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  // Create a test item before running purchase tests
  beforeAll(async () => {
    const response = await fetch(itemsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Test Medicine for Purchase',
        unit: 'tablet',
        reorderLevel: 50,
      }),
    });
    const data = await response.json();
    testItemId = data.uuid;
  });

  // Clean up test item after tests
  afterAll(async () => {
    if (testItemId) {
      await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'DELETE',
        headers,
      });
    }
  });

  describe('POST /medical/purchases', () => {
    it('should create a purchase and update stock', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          purchaseDate: '2025-01-07',
          batchNo: 'BATCH001',
          expiryDate: '2026-01-07',
          quantity: 100,
          supplier: 'ABC Pharma',
          invoiceNumber: 'INV-001',
          costPerUnit: 5.50,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('uuid');
      expect(data.itemId).toBe(testItemId);
      expect(data.itemName).toBe('Test Medicine for Purchase');
      expect(data.quantity).toBe(100);
      expect(data.status).toBe('active');

      createdPurchaseId = data.uuid;

      // Verify stock was updated
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(100);
    });

    it('should return 400 for missing itemId', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchaseDate: '2025-01-07',
          quantity: 50,
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
          purchaseDate: '2025-01-07',
          quantity: 50,
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
          purchaseDate: '2025-01-07',
          quantity: 0,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /medical/purchases/{id}', () => {
    it('should get purchase by ID', async () => {
      const response = await fetch(`${purchasesUrl}/${createdPurchaseId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdPurchaseId);
      expect(data.itemId).toBe(testItemId);
      expect(data.itemName).toBe('Test Medicine for Purchase');
    });

    it('should return 404 for non-existent purchase', async () => {
      const response = await fetch(`${purchasesUrl}/nonexistent1`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /medical/purchases', () => {
    it('should list purchases with no parameters (default date range)', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should list purchases by itemId', async () => {
      // Include date range that covers test data
      const response = await fetch(
        `${purchasesUrl}?itemId=${testItemId}&startDate=2025-01-01&endDate=2030-12-31`,
        {
          method: 'GET',
          headers,
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].itemId).toBe(testItemId);
      expect(data[0].itemName).toBe('Test Medicine for Purchase');
    });

    it('should list purchases with custom date range', async () => {
      const response = await fetch(
        `${purchasesUrl}?startDate=2025-01-01&endDate=2025-12-31`,
        {
          method: 'GET',
          headers,
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should return 400 for invalid startDate format', async () => {
      const response = await fetch(`${purchasesUrl}?startDate=invalid`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid endDate format', async () => {
      const response = await fetch(`${purchasesUrl}?endDate=01-01-2025`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(400);
    });

    it('should exclude deleted purchases by default', async () => {
      // Create a purchase
      const createResponse = await fetch(purchasesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          purchaseDate: '2025-01-08',
          quantity: 10,
        }),
      });
      const createdPurchase = await createResponse.json();

      // Delete the purchase
      await fetch(`${purchasesUrl}/${createdPurchase.uuid}`, {
        method: 'DELETE',
        headers,
      });

      // List without includeDeleted - should not find the deleted purchase
      const listResponse = await fetch(
        `${purchasesUrl}?itemId=${testItemId}&startDate=2025-01-01&endDate=2030-12-31`,
        {
          method: 'GET',
          headers,
        }
      );

      expect(listResponse.status).toBe(200);
      const results = await listResponse.json();
      const found = results.find((p: any) => p.uuid === createdPurchase.uuid);
      expect(found).toBeUndefined();
    });

    it('should include deleted purchases when includeDeleted=true', async () => {
      // Create a purchase
      const createResponse = await fetch(purchasesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          purchaseDate: '2025-01-09',
          quantity: 10,
        }),
      });
      const createdPurchase = await createResponse.json();

      // Delete the purchase
      await fetch(`${purchasesUrl}/${createdPurchase.uuid}`, {
        method: 'DELETE',
        headers,
      });

      // List with includeDeleted=true - should find the deleted purchase
      const listResponse = await fetch(
        `${purchasesUrl}?itemId=${testItemId}&startDate=2025-01-01&endDate=2030-12-31&includeDeleted=true`,
        {
          method: 'GET',
          headers,
        }
      );

      expect(listResponse.status).toBe(200);
      const results = await listResponse.json();
      const found = results.find((p: any) => p.uuid === createdPurchase.uuid);
      expect(found).toBeDefined();
      expect(found.status).toBe('deleted');
    });
  });

  describe('PUT /medical/purchases/{id}', () => {
    it('should update purchase and adjust stock', async () => {
      // Update quantity from 100 to 150 (should add 50 to stock)
      const response = await fetch(`${purchasesUrl}/${createdPurchaseId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          quantity: 150,
          supplier: 'XYZ Pharma',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.quantity).toBe(150);
      expect(data.supplier).toBe('XYZ Pharma');

      // Verify stock was adjusted
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(150);
    });
  });

  describe('DELETE /medical/purchases/{id}', () => {
    it('should delete purchase and reverse stock', async () => {
      const response = await fetch(`${purchasesUrl}/${createdPurchaseId}`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(200);

      // Verify stock was reversed (150 - 150 = 0)
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
