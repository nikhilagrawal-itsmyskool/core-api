import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Sport Breakage API', () => {
  const itemsUrl = `${BASE_URL}/items`;
  const purchasesUrl = `${BASE_URL}/purchases`;
  const breakagesUrl = `${BASE_URL}/breakages`;

  const testSportType = 'cricket';
  let testItemId: string;
  let createdBreakageId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  beforeAll(async () => {
    // Create test item
    const itemResponse = await fetch(itemsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sportType: testSportType,
        name: 'Test Tube',
        itemType: 'equipment',
        unit: 'piece',
        category: 'Glassware',
        costPerUnit: 25.00,
      }),
    });
    const itemData = await itemResponse.json();
    testItemId = itemData.uuid;

    // Add stock via purchase
    await fetch(purchasesUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        itemId: testItemId,
        sportType: testSportType,
        purchaseDate: '2026-01-01',
        quantity: 100,
      }),
    });
  });

  afterAll(async () => {
    if (testItemId) {
      await fetch(`${itemsUrl}/${testItemId}`, { method: 'DELETE', headers });
    }
  });

  describe('POST /sport/breakages', () => {
    it('should create a breakage and decrease stock', async () => {
      const response = await fetch(breakagesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          sportType: testSportType,
          breakageDate: '2026-02-15',
          quantity: 3,
          responsibleType: 'student',
          responsibleName: 'Rahul',
          responsibleClass: '10-A',
          cause: 'accident',
          estimatedCost: 75.00,
          remarks: 'Dropped during experiment',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('uuid');
      expect(data.itemId).toBe(testItemId);
      expect(data.itemName).toBe('Test Tube');
      expect(data.quantity).toBe(3);
      expect(data.responsibleType).toBe('student');
      expect(data.responsibleName).toBe('Rahul');
      expect(data.cause).toBe('accident');
      expect(data.breakageStatus).toBe('reported');

      createdBreakageId = data.uuid;

      // Verify stock decreased (100 - 3 = 97)
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(97);
    });

    it('should return 400 for missing item ID', async () => {
      const response = await fetch(breakagesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sportType: testSportType,
          breakageDate: '2026-02-15',
          quantity: 1,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid quantity', async () => {
      const response = await fetch(breakagesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          sportType: testSportType,
          breakageDate: '2026-02-15',
          quantity: 0,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid responsible type', async () => {
      const response = await fetch(breakagesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          sportType: testSportType,
          breakageDate: '2026-02-15',
          quantity: 1,
          responsibleType: 'invalid',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /sport/breakages/{id}', () => {
    it('should get breakage by ID', async () => {
      const response = await fetch(`${breakagesUrl}/${createdBreakageId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdBreakageId);
      expect(data.itemName).toBe('Test Tube');
    });

    it('should return 404 for non-existent breakage', async () => {
      const response = await fetch(`${breakagesUrl}/nonexistent1`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /sport/breakages', () => {
    it('should list breakages with date range', async () => {
      const response = await fetch(
        `${breakagesUrl}?sportType=${testSportType}&startDate=2026-01-01&endDate=2026-12-31`,
        { method: 'GET', headers }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe('PUT /sport/breakages/{id}', () => {
    it('should update breakage', async () => {
      const response = await fetch(`${breakagesUrl}/${createdBreakageId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          actionTaken: 'cost_recovered',
          breakageStatus: 'resolved',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.actionTaken).toBe('cost_recovered');
      expect(data.breakageStatus).toBe('resolved');
    });

    it('should update breakage quantity and adjust stock', async () => {
      const response = await fetch(`${breakagesUrl}/${createdBreakageId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          quantity: 5,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.quantity).toBe(5);

      // Stock adjusted: 97 + 3 - 5 = 95
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(95);
    });
  });

  describe('DELETE /sport/breakages/{id}', () => {
    it('should delete breakage and restore stock', async () => {
      const response = await fetch(`${breakagesUrl}/${createdBreakageId}`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(200);

      // Stock restored: 95 + 5 = 100
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(100);
    });

    it('should return 404 for deleting non-existent breakage', async () => {
      const response = await fetch(`${breakagesUrl}/nonexistent1`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });
});
