import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Sport In-charge API', () => {
  const sportType = 'cricket';
  const inchargesUrl = `${BASE_URL}/sports/${sportType}/incharges`;
  const allInchargesUrl = `${BASE_URL}/sports/incharges`;

  const empA = 'empaaaaaaaaa';
  const empB = 'empbbbbbbbbb';

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  describe('PUT /sport/sports/{sportType}/incharges', () => {
    it('should set multiple in-charges for a sport', async () => {
      const response = await fetch(inchargesUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ inChargeIds: [empA, empB] }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
      expect(data.map((r: any) => r.inChargeId).sort()).toEqual([empA, empB].sort());
      data.forEach((r: any) => expect(r.sportType).toBe(sportType));
    });

    it('should replace the in-charge list (declarative)', async () => {
      const response = await fetch(inchargesUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ inChargeIds: [empA] }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.length).toBe(1);
      expect(data[0].inChargeId).toBe(empA);
    });

    it('should dedupe repeated in-charge ids', async () => {
      const response = await fetch(inchargesUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ inChargeIds: [empA, empA, empB] }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.length).toBe(2);
    });

    it('should clear in-charges with an empty array', async () => {
      const response = await fetch(inchargesUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ inChargeIds: [] }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.length).toBe(0);
    });

    it('should return 400 for an invalid sport type', async () => {
      const response = await fetch(`${BASE_URL}/sports/not_a_sport/incharges`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ inChargeIds: [empA] }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 when inChargeIds is not an array', async () => {
      const response = await fetch(inchargesUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ inChargeIds: 'nope' }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /sport/sports/{sportType}/incharges', () => {
    it('should list in-charges for a sport', async () => {
      await fetch(inchargesUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ inChargeIds: [empA, empB] }),
      });

      const response = await fetch(inchargesUrl, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
    });
  });

  describe('GET /sport/sports/incharges', () => {
    it('should list all in-charge mappings for the school', async () => {
      const response = await fetch(allInchargesUrl, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.some((r: any) => r.sportType === sportType)).toBe(true);
    });
  });
});
