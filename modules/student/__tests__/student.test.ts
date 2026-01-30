import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Student API', () => {
  const searchUrl = `${BASE_URL}/search`;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  describe('GET /student/health', () => {
    it('should return health status', async () => {
      const response = await fetch(`${BASE_URL}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('status', 'ok');
      expect(data).toHaveProperty('module', 'student');
    });
  });

  describe('GET /student/search', () => {
    it('should return all students without filters', async () => {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should search students by name', async () => {
      const response = await fetch(`${searchUrl}?name=Kumar`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
    });

    it('should return empty array for non-matching name', async () => {
      const response = await fetch(`${searchUrl}?name=NONEXISTENT_STUDENT_XYZ`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
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
