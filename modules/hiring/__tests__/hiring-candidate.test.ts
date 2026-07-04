import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Hiring Candidate API', () => {
  const candidatesUrl = `${BASE_URL}/candidates`;
  let createdId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  describe('POST /hiring/candidates', () => {
    it('should create a new candidate', async () => {
      const response = await fetch(candidatesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Anita Sharma',
          fatherHusbandName: 'Ramesh Sharma',
          positionType: 'pgt',
          subjects: ['physics', 'mathematics'],
          mobile: '9876500011',
          email: 'anita.sharma@example.com',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.name).toBe('Anita Sharma');
      expect(data.positionType).toBe('pgt');
      expect(data.subjects).toEqual(['physics', 'mathematics']);
      expect(data.status).toBe('applied');

      createdId = data.uuid;
    });

    it('should return 400 for missing name', async () => {
      const response = await fetch(candidatesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ positionType: 'tgt' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid positionType', async () => {
      const response = await fetch(candidatesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'X', positionType: 'director' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for missing X-School-Code', async () => {
      const response = await fetch(candidatesUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X', positionType: 'tgt' }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /hiring/candidates/:id', () => {
    it('should get candidate by id with stages array', async () => {
      const response = await fetch(`${candidatesUrl}/${createdId}`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdId);
      expect(data).toHaveProperty('stages');
      expect(Array.isArray(data.stages)).toBe(true);
    });

    it('should return 404 for unknown id', async () => {
      const response = await fetch(`${candidatesUrl}/nonexistent0`, { headers });
      expect(response.status).toBe(404);
    });
  });

  describe('GET /hiring/candidates', () => {
    it('should list candidates', async () => {
      const response = await fetch(candidatesUrl, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should filter by positionType', async () => {
      const response = await fetch(`${candidatesUrl}?positionType=pgt`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach((c: any) => expect(c.positionType).toBe('pgt'));
    });

    it('should search by mobile', async () => {
      const response = await fetch(`${candidatesUrl}?search=9876500011`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.some((c: any) => c.uuid === createdId)).toBe(true);
    });

    it('should return 400 for invalid status filter', async () => {
      const response = await fetch(`${candidatesUrl}?status=bogus`, { headers });
      expect(response.status).toBe(400);
    });
  });

  describe('PUT /hiring/candidates/:id', () => {
    it('should update final review fields and derive status from decision', async () => {
      const response = await fetch(`${candidatesUrl}/${createdId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          finalComments: 'Strong subject knowledge',
          salaryRequested: 45000,
          salaryOffered: 42000,
          finalDecision: 'selected',
        }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.salaryRequested).toBe(45000);
      expect(data.salaryOffered).toBe(42000);
      expect(data.finalDecision).toBe('selected');
      expect(data.status).toBe('selected');
    });

    it('should return 400 for invalid finalDecision', async () => {
      const response = await fetch(`${candidatesUrl}/${createdId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ finalDecision: 'maybe' }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /hiring/candidates/:id', () => {
    it('should withdraw a candidate', async () => {
      const createRes = await fetch(candidatesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'To Withdraw', positionType: 'prt' }),
      });
      const created = await createRes.json();

      const response = await fetch(`${candidatesUrl}/${created.uuid}`, {
        method: 'DELETE',
        headers,
      });
      expect(response.status).toBe(200);

      const getRes = await fetch(`${candidatesUrl}/${created.uuid}`, { headers });
      const got = await getRes.json();
      expect(got.status).toBe('withdrawn');
    });
  });
});
