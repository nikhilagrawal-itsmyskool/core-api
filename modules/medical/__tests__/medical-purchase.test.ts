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
        reorder_level: 50,
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
          item_id: testItemId,
          purchase_date: '2025-01-07',
          batch_no: 'BATCH001',
          expiry_date: '2026-01-07',
          quantity: 100,
          supplier: 'ABC Pharma',
          invoice_number: 'INV-001',
          cost_per_unit: 5.50,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('uuid');
      expect(data.item_id).toBe(testItemId);
      expect(data.quantity).toBe(100);
      expect(data.status).toBe('active');

      createdPurchaseId = data.uuid;

      // Verify stock was updated
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.current_stock).toBe(100);
    });

    it('should return 400 for missing item_id', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchase_date: '2025-01-07',
          quantity: 50,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid item_id', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          item_id: 'nonexistent1',
          purchase_date: '2025-01-07',
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
          item_id: testItemId,
          purchase_date: '2025-01-07',
          quantity: 0,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /medical/purchases', () => {
    it('should list purchases by item_id', async () => {
      const response = await fetch(`${purchasesUrl}?item_id=${testItemId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].item_id).toBe(testItemId);
    });

    it('should return 400 for missing item_id parameter', async () => {
      const response = await fetch(purchasesUrl, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(400);
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
      expect(itemData.current_stock).toBe(150);
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
      expect(itemData.current_stock).toBe(0);
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
