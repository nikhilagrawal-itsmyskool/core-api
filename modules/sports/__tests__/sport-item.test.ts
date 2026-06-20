import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Sport Item API', () => {
  const itemsUrl = `${BASE_URL}/items`;
  const testSportType = 'cricket';
  let createdItemId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  describe('POST /sport/items', () => {
    it('should create a new sport item', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sportType: testSportType,
          name: 'Ammeter',
          category: 'Electrical',
          itemType: 'equipment',
          unit: 'piece',
          reorderLevel: 5,
          itemCondition: 'new',
          costPerUnit: 250.00,
          comments: 'Digital ammeter 0-5A',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('uuid');
      expect(data.name).toBe('Ammeter');
      expect(data.category).toBe('Electrical');
      expect(data.itemType).toBe('equipment');
      expect(data.unit).toBe('piece');
      expect(data.currentStock).toBe(0);
      expect(data.reorderLevel).toBe(5);
      expect(data.itemCondition).toBe('new');
      expect(data.status).toBe('active');

      createdItemId = data.uuid;
    });

    it('should return 400 for missing sport type', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Test Item',
          itemType: 'equipment',
          unit: 'piece',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid item type', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sportType: testSportType,
          name: 'Test Item',
          itemType: 'invalid',
          unit: 'piece',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid unit', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sportType: testSportType,
          name: 'Test Item',
          itemType: 'equipment',
          unit: 'invalid_unit',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /sport/items/{id}', () => {
    it('should get item by ID', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdItemId);
      expect(data.name).toBe('Ammeter');
    });

    it('should return 404 for non-existent item', async () => {
      const response = await fetch(`${itemsUrl}/nonexistent1`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /sport/items (search)', () => {
    it('should return all items without filters', async () => {
      const response = await fetch(itemsUrl, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should filter items by sportType', async () => {
      const response = await fetch(`${itemsUrl}?sportType=${testSportType}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].sportType).toBe(testSportType);
    });

    it('should search items by name', async () => {
      const response = await fetch(`${itemsUrl}?search=Ammeter`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should filter items by itemType', async () => {
      const response = await fetch(`${itemsUrl}?itemType=equipment`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach((item: any) => {
        expect(item.itemType).toBe('equipment');
      });
    });
  });

  describe('PUT /sport/items/{id}', () => {
    it('should update item', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: 'Digital Ammeter',
          reorderLevel: 10,
          itemCondition: 'good',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe('Digital Ammeter');
      expect(data.reorderLevel).toBe(10);
      expect(data.itemCondition).toBe('good');
    });

    it('should return 404 for updating non-existent item', async () => {
      const response = await fetch(`${itemsUrl}/nonexistent1`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /sport/items/{id}', () => {
    it('should soft delete item', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(200);
    });

    it('should not find deleted item', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(404);
    });

    it('should return 404 for deleting non-existent item', async () => {
      const response = await fetch(`${itemsUrl}/nonexistent1`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });
});
