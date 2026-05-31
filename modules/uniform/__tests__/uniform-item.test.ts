import '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';
import { createTestSchool, cleanupTestSchool, TestSchool } from './test-school';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Uniform Item API', () => {
  let school: TestSchool;
  let headers: Record<string, string>;
  const itemsUrl = `${BASE_URL}/items`;
  let createdItemId: string;
  let createdSizeId: string;

  beforeAll(async () => {
    school = await createTestSchool();
    headers = { 'Content-Type': 'application/json', 'X-School-Code': school.schoolCode };
  });

  afterAll(async () => {
    await cleanupTestSchool(school);
  });

  describe('POST /uniform/items', () => {
    it('should create a new item', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Test Shirt', category: 'summer', gender: 'male', description: 'Test shirt' }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.name).toBe('Test Shirt');
      expect(data.category).toBe('summer');
      expect(data.gender).toBe('male');
      expect(data.status).toBe('active');
      createdItemId = data.uuid;
    });

    it('should return 400 for missing name', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ category: 'summer', gender: 'male' }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty('error');
    });

    it('should return 400 for invalid category', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ name: 'Bad Item', category: 'invalid', gender: 'male' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid gender', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ name: 'Bad Item', category: 'summer', gender: 'other' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for missing X-School-Code header', async () => {
      const response = await fetch(itemsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', category: 'summer', gender: 'male' }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /uniform/items', () => {
    it('should list all items', async () => {
      const response = await fetch(itemsUrl, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should filter items by category', async () => {
      const response = await fetch(`${itemsUrl}?category=summer`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach((item: any) => expect(item.category).toBe('summer'));
    });

    it('should filter items by gender', async () => {
      const response = await fetch(`${itemsUrl}?gender=male`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should return 400 for invalid category filter', async () => {
      const response = await fetch(`${itemsUrl}?category=bad`, { method: 'GET', headers });
      expect(response.status).toBe(400);
    });

    it('should return items with sizes array', async () => {
      const response = await fetch(itemsUrl, { method: 'GET', headers });
      const data = await response.json();
      const testItem = data.find((i: any) => i.uuid === createdItemId);
      expect(testItem).toBeDefined();
      expect(Array.isArray(testItem.sizes)).toBe(true);
    });
  });

  describe('PUT /uniform/items/{id}', () => {
    it('should update item', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ name: 'Test Shirt Updated', description: 'Updated' }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe('Test Shirt Updated');
    });

    it('should return 404 for non-existent item', async () => {
      const response = await fetch(`${itemsUrl}/nonexistent1`, {
        method: 'PUT', headers,
        body: JSON.stringify({ name: 'X' }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('POST /uniform/items/{id}/sizes', () => {
    it('should create a size', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}/sizes`, {
        method: 'POST', headers,
        body: JSON.stringify({ sizeLabel: '38', mrp: 450, studentDiscountPct: 10, bulkDiscountPct: 5 }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.sizeLabel).toBe('38');
      expect(data.mrp).toBe(450);
      expect(data.studentDiscountPct).toBe(10);
      expect(data.currentStock).toBe(0);
      createdSizeId = data.uuid;
    });

    it('should return 400 for missing sizeLabel', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}/sizes`, {
        method: 'POST', headers,
        body: JSON.stringify({ mrp: 100 }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent item', async () => {
      const response = await fetch(`${itemsUrl}/nonexistent1/sizes`, {
        method: 'POST', headers,
        body: JSON.stringify({ sizeLabel: '38' }),
      });
      expect(response.status).toBe(404);
    });

    it('should return 400 for duplicate size label', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}/sizes`, {
        method: 'POST', headers,
        body: JSON.stringify({ sizeLabel: '38', mrp: 450 }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('PUT /uniform/items/{id}/sizes/{sizeId}', () => {
    it('should update size MRP and discounts', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}/sizes/${createdSizeId}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ mrp: 500, studentDiscountPct: 12 }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.mrp).toBe(500);
      expect(data.studentDiscountPct).toBe(12);
    });

    it('should return 404 for non-existent size', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}/sizes/nonexistent1`, {
        method: 'PUT', headers,
        body: JSON.stringify({ mrp: 100 }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /uniform/items/{id}/sizes/{sizeId}', () => {
    it('should soft-delete the size', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}/sizes/${createdSizeId}`, {
        method: 'DELETE', headers,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toHaveProperty('message');
    });
  });

  describe('DELETE /uniform/items/{id}', () => {
    it('should soft-delete the item', async () => {
      const response = await fetch(`${itemsUrl}/${createdItemId}`, { method: 'DELETE', headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toHaveProperty('message');
    });

    it('should not list deleted item', async () => {
      const response = await fetch(itemsUrl, { method: 'GET', headers });
      const data = await response.json();
      expect(data.find((i: any) => i.uuid === createdItemId)).toBeUndefined();
    });

    it('should return 404 for deleting non-existent item', async () => {
      const response = await fetch(`${itemsUrl}/nonexistent1`, { method: 'DELETE', headers });
      expect(response.status).toBe(404);
    });
  });
});
