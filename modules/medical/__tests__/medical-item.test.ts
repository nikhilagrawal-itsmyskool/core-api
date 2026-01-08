import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

// Load module config - use GATEWAY_PORT env var if set, otherwise use module port
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Medical Item API', () => {
  const itemsUrl = `${BASE_URL}/items`;
  let createdItemId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  describe('POST /medical/items', () => {
    it('should create a new medical item', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Paracetamol 500mg',
          unit: 'tablet',
          reorder_level: 100,
          comments: 'For fever and pain relief',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('uuid');
      expect(data.name).toBe('Paracetamol 500mg');
      expect(data.unit).toBe('tablet');
      expect(data.reorder_level).toBe(100);
      expect(data.current_stock).toBe(0);
      expect(data.status).toBe('active');

      createdItemId = data.uuid;
    });

    it('should return 400 for missing name', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          unit: 'tablet',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should return 400 for invalid unit', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Test Item',
          unit: 'invalid_unit',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should return 400 for missing X-School-Code header', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Item',
          unit: 'tablet',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('GET /medical/items/{id}', () => {
    it('should get item by ID', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.uuid).toBe(createdItemId);
      expect(data.name).toBe('Paracetamol 500mg');
    });

    it('should return 404 for non-existent item', async () => {
      const response = await fetch(`${itemsUrl}/nonexistent1`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('GET /medical/items (search)', () => {
    it('should return all items without search term', async () => {
      const response = await fetch(itemsUrl, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should search items by name', async () => {
      const response = await fetch(`${itemsUrl}?search=Paracetamol`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].name).toContain('Paracetamol');
    });

    it('should search items by comments', async () => {
      const response = await fetch(`${itemsUrl}?search=fever`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe('PUT /medical/items/{id}', () => {
    it('should update item', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: 'Paracetamol 650mg',
          reorder_level: 150,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.uuid).toBe(createdItemId);
      expect(data.name).toBe('Paracetamol 650mg');
      expect(data.reorder_level).toBe(150);
    });

    it('should return 404 for updating non-existent item', async () => {
      const response = await fetch(`${itemsUrl}/nonexistent1`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: 'Updated Name',
        }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /medical/items/{id}', () => {
    it('should soft delete item', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('message');
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
