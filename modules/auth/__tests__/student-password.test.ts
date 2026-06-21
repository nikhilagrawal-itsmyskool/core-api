import { TEST_SCHOOL_CODE, TEST_USERNAME, TEST_PASSWORD } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

// Load module config - use GATEWAY_PORT env var if set, otherwise use module port
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

async function getStudentToken(password = TEST_PASSWORD): Promise<string> {
  const response = await fetch(`${BASE_URL}/student/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-School-Code': TEST_SCHOOL_CODE,
    },
    body: JSON.stringify({ username: TEST_USERNAME, password }),
  });
  const data = await response.json();
  return data.token;
}

describe('Student Password API', () => {
  const changePasswordUrl = `${BASE_URL}/student/change-password`;

  describe('POST /auth/student/change-password', () => {
    it('should change password successfully', async () => {
      const token = await getStudentToken();
      const newPassword = 'NewPassword@456';

      const response = await fetch(changePasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('message');

      // Change back to the original password using a token from the new password.
      const token2 = await getStudentToken(newPassword);
      const restore = await fetch(changePasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token2}`,
        },
        body: JSON.stringify({ currentPassword: newPassword, newPassword: TEST_PASSWORD }),
      });
      expect(restore.status).toBe(200);
    });

    it('should return 400 for wrong current password', async () => {
      const token = await getStudentToken();

      const response = await fetch(changePasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'NewPassword@456' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should return 400 for missing fields', async () => {
      const token = await getStudentToken();

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: 'NewPassword@456' }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });
});
