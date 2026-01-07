import { BASE_URL, TEST_SCHOOL_CODE, TEST_USERNAME, TEST_PASSWORD } from '../../../tests/setup';

describe('Student Auth API', () => {
  const loginUrl = `${BASE_URL}/auth/student/login`;

  describe('POST /auth/student/login', () => {
    it('should return JWT token on successful login', async () => {
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
    });

    it('should return JWT with login_name, school_code, and type=student', async () => {
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
      expect(payload).toHaveProperty('type', 'student');
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
