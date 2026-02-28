import { TEST_SCHOOL_CODE, TEST_USERNAME, TEST_PASSWORD } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

// Load module config - use GATEWAY_PORT env var if set, otherwise use module port
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

async function getAuthToken(): Promise<string> {
  const response = await fetch(`${BASE_URL}/employee/login`, {
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
  const data = await response.json();
  return data.token;
}

describe('Employee Password API', () => {
  const changePasswordUrl = `${BASE_URL}/employee/change-password`;
  const resetPasswordUrl = `${BASE_URL}/employee/reset-password`;

  describe('POST /auth/employee/change-password', () => {
    it('should change password successfully', async () => {
      const token = await getAuthToken();
      const newPassword = 'NewPassword@456';

      // Change to new password
      const response = await fetch(changePasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword: TEST_PASSWORD,
          newPassword: newPassword,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('message');

      // Change back to original password
      const token2 = await fetch(`${BASE_URL}/employee/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-School-Code': TEST_SCHOOL_CODE,
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: newPassword,
        }),
      }).then(r => r.json()).then(d => d.token);

      const restoreResponse = await fetch(changePasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token2}`,
        },
        body: JSON.stringify({
          currentPassword: newPassword,
          newPassword: TEST_PASSWORD,
        }),
      });

      expect(restoreResponse.status).toBe(200);
    });

    it('should return 400 for wrong current password', async () => {
      const token = await getAuthToken();

      const response = await fetch(changePasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword: 'wrong-password',
          newPassword: 'NewPassword@456',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should return 400 for missing fields', async () => {
      const token = await getAuthToken();

      const response = await fetch(changePasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should return 401 for missing auth header', async () => {
      const response = await fetch(changePasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: TEST_PASSWORD,
          newPassword: 'NewPassword@456',
        }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('POST /auth/employee/reset-password', () => {
    it('should reset password successfully with god role', async () => {
      const token = await getAuthToken();

      // Get the login ID from the token payload
      const [, payloadBase64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
      const loginId = payload.id;

      const response = await fetch(resetPasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          employeeLoginId: loginId,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('message');

      // Password is now reset to Itsmyskool@123 (which is TEST_PASSWORD)
      // Verify we can still login
      const loginResponse = await fetch(`${BASE_URL}/employee/login`, {
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

      expect(loginResponse.status).toBe(200);

      // After reset, mustChangePassword should be true
      const loginData = await loginResponse.json();
      expect(loginData.mustChangePassword).toBe(true);

      // Restore must_change_password to false by changing password back
      const token3 = loginData.token;
      await fetch(changePasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token3}`,
        },
        body: JSON.stringify({
          currentPassword: TEST_PASSWORD,
          newPassword: TEST_PASSWORD,
        }),
      });
    });

    it('should return 400 for missing employeeLoginId', async () => {
      const token = await getAuthToken();

      const response = await fetch(resetPasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should return 401 for missing auth header', async () => {
      const response = await fetch(resetPasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          employeeLoginId: 'some-id',
        }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });
});
