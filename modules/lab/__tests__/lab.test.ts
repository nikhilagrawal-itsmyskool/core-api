import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Lab API', () => {
  const labsUrl = `${BASE_URL}/labs`;
  let createdLabId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  describe('POST /lab/labs', () => {
    it('should create a new lab', async () => {
      const response = await fetch(labsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Physics Lab',
          type: 'physics',
          location: 'Building A, Room 101',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('uuid');
      expect(data.name).toBe('Physics Lab');
      expect(data.type).toBe('physics');
      expect(data.location).toBe('Building A, Room 101');
      expect(data.status).toBe('active');

      createdLabId = data.uuid;
    });

    it('should return 400 for missing name', async () => {
      const response = await fetch(labsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'physics',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid type', async () => {
      const response = await fetch(labsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Test Lab',
          type: 'invalid_type',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing X-School-Code header', async () => {
      const response = await fetch(labsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Lab',
          type: 'physics',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /lab/labs/{id}', () => {
    it('should get lab by ID', async () => {
      const response = await fetch(`${labsUrl}/${createdLabId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdLabId);
      expect(data.name).toBe('Physics Lab');
    });

    it('should return 404 for non-existent lab', async () => {
      const response = await fetch(`${labsUrl}/nonexistent1`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /lab/labs', () => {
    it('should list all labs', async () => {
      const response = await fetch(labsUrl, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe('PUT /lab/labs/{id}', () => {
    it('should update lab', async () => {
      const response = await fetch(`${labsUrl}/${createdLabId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: 'Advanced Physics Lab',
          location: 'Building B, Room 201',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe('Advanced Physics Lab');
      expect(data.location).toBe('Building B, Room 201');
    });

    it('should return 404 for updating non-existent lab', async () => {
      const response = await fetch(`${labsUrl}/nonexistent1`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /lab/labs/{id}', () => {
    it('should soft delete lab', async () => {
      const response = await fetch(`${labsUrl}/${createdLabId}`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(200);
    });

    it('should not find deleted lab', async () => {
      const response = await fetch(`${labsUrl}/${createdLabId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(404);
    });

    it('should return 404 for deleting non-existent lab', async () => {
      const response = await fetch(`${labsUrl}/nonexistent1`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });
});
