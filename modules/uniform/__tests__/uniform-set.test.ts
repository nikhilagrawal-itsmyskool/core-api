import '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';
import { createTestSchool, cleanupTestSchool, TestSchool } from './test-school';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Uniform Set API', () => {
  let school: TestSchool;
  let headers: Record<string, string>;
  const itemsUrl = `${BASE_URL}/items`;
  const setsUrl = `${BASE_URL}/sets`;

  let testItemId: string;
  let createdSetId: string;

  beforeAll(async () => {
    school = await createTestSchool();
    headers = { 'Content-Type': 'application/json', 'X-School-Code': school.schoolCode };

    const itemRes = await fetch(itemsUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'Set Shirt', category: 'summer', gender: 'male' }),
    });
    testItemId = (await itemRes.json()).uuid;
  });

  afterAll(async () => {
    await cleanupTestSchool(school);
  });

  describe('POST /uniform/sets', () => {
    it('should create a new set', async () => {
      const response = await fetch(setsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({
          name: 'Boys Summer Set',
          gender: 'male',
          description: 'Standard summer uniform',
          items: [{ itemId: testItemId, quantity: 2, sortOrder: 1 }],
        }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.name).toBe('Boys Summer Set');
      expect(data.gender).toBe('male');
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items[0].quantity).toBe(2);
      createdSetId = data.uuid;
    });

    it('should return 400 for missing name', async () => {
      const response = await fetch(setsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ gender: 'male', items: [{ itemId: testItemId, quantity: 1 }] }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for empty items array', async () => {
      const response = await fetch(setsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ name: 'Empty Set', items: [] }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid gender', async () => {
      const response = await fetch(setsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ name: 'Bad Set', gender: 'other', items: [{ itemId: testItemId, quantity: 1 }] }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /uniform/sets', () => {
    it('should list all sets', async () => {
      const response = await fetch(setsUrl, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should filter by gender', async () => {
      const response = await fetch(`${setsUrl}?gender=male`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.some((s: any) => s.uuid === createdSetId)).toBe(true);
    });
  });

  describe('GET /uniform/sets/{id}', () => {
    it('should get set by ID with items', async () => {
      const response = await fetch(`${setsUrl}/${createdSetId}`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdSetId);
      expect(data.name).toBe('Boys Summer Set');
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items[0].itemId).toBe(testItemId);
    });

    it('should return 404 for non-existent set', async () => {
      const response = await fetch(`${setsUrl}/nonexistent1`, { method: 'GET', headers });
      expect(response.status).toBe(404);
    });
  });

  describe('GET /uniform/sets/{id}/expand', () => {
    it('should expand set into item list without sizes', async () => {
      const response = await fetch(`${setsUrl}/${createdSetId}/expand`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0].itemId).toBe(testItemId);
      expect(data[0].quantity).toBe(2);
    });
  });

  describe('PUT /uniform/sets/{id}', () => {
    it('should update set name', async () => {
      const response = await fetch(`${setsUrl}/${createdSetId}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ name: 'Boys Summer Set Updated' }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).name).toBe('Boys Summer Set Updated');
    });

    it('should return 404 for non-existent set', async () => {
      const response = await fetch(`${setsUrl}/nonexistent1`, {
        method: 'PUT', headers,
        body: JSON.stringify({ name: 'X' }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /uniform/sets/{id}', () => {
    it('should soft-delete the set', async () => {
      const response = await fetch(`${setsUrl}/${createdSetId}`, { method: 'DELETE', headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toHaveProperty('message');
    });

    it('should not list deleted set', async () => {
      const response = await fetch(setsUrl, { method: 'GET', headers });
      const data = await response.json();
      expect(data.find((s: any) => s.uuid === createdSetId)).toBeUndefined();
    });
  });
});
