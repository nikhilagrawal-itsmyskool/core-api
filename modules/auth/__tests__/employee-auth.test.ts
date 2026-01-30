import { TEST_SCHOOL_CODE, TEST_USERNAME, TEST_PASSWORD } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

// Load module config - use GATEWAY_PORT env var if set, otherwise use module port
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Employee Auth API', () => {
  const loginUrl = `${BASE_URL}/employee/login`;

  describe('POST /auth/employee/login', () => {
    it('should return JWT token and displayName on successful login', async () => {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-School-Code': TEST_SCHOOL_CODE,
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('token');
      expect(typeof data.token).toBe('string');
      expect(data).toHaveProperty('displayName');
      expect(typeof data.displayName).toBe('string');
    });

    it('should return JWT with login_name, school_code, and roles', async () => {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-School-Code': TEST_SCHOOL_CODE,
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Decode JWT payload (without verification)
      const [, payloadBase64] = data.token.split('.');
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());

      expect(payload).toHaveProperty('login_name', TEST_USERNAME);
      expect(payload).toHaveProperty('school_code', TEST_SCHOOL_CODE);
      expect(payload).toHaveProperty('roles');
      expect(Array.isArray(payload.roles)).toBe(true);
    });

    it('should return 401 for invalid password', async () => {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-School-Code': TEST_SCHOOL_CODE,
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: 'wrong-password',
        }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should return 400 for invalid school code', async () => {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-School-Code': 'INVALID_SCHOOL',
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should return 400 for missing credentials', async () => {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-School-Code': TEST_SCHOOL_CODE,
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should return 400 for missing X-School-Code header', async () => {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });
});
