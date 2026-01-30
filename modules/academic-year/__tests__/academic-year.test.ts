import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Academic Year API', () => {
  const searchUrl = `${BASE_URL}/search`;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  describe('GET /academic-year/health', () => {
    it('should return health status', async () => {
      const response = await fetch(`${BASE_URL}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('status', 'ok');
      expect(data).toHaveProperty('module', 'academic-year');
    });
  });

  describe('GET /academic-year/search', () => {
    it('should return all academic years', async () => {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('uuid');
      expect(data[0]).toHaveProperty('name');
    });

    it('should return results ordered by start_date desc', async () => {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
    });

    it('should return 400 for missing X-School-Code header', async () => {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });
});
