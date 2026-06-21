import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Employee API', () => {
  const searchUrl = `${BASE_URL}/search`;
  const createUrl = `${BASE_URL}/create`;
  const rolesUrl = `${BASE_URL}/roles`;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  // Unique per run so repeated test runs never collide on family_unique_number.
  const stamp = Date.now();
  const familyA = `T${stamp}`;
  const familyB = `T${stamp + 1}`;

  let createdId: string;
  let createdWithRoleId: string;
  let adminRoleId: string;

  describe('GET /employee/health', () => {
    it('should return health status', async () => {
      const response = await fetch(`${BASE_URL}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('status', 'ok');
      expect(data).toHaveProperty('module', 'employee');
    });
  });

  describe('GET /employee/roles', () => {
    it('should list roles for the school including admin and god', async () => {
      const response = await fetch(rolesUrl, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);

      const codes = data.map((r: any) => r.code);
      expect(codes).toContain('admin');
      expect(codes).toContain('god');

      adminRoleId = data.find((r: any) => r.code === 'admin').uuid;
      expect(adminRoleId).toBeDefined();
    });
  });

  describe('POST /employee/create', () => {
    it('should create an employee and auto-create the login', async () => {
      const response = await fetch(createUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Test Teacher',
          familyUniqueNumber: familyA,
          employeeNumber: `EMP${stamp}`,
          gender: 'M',
          mobile: '9999999999',
          email: 'test.teacher@example.com',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.name).toBe('Test Teacher');
      expect(data.familyUniqueNumber).toBe(familyA);
      expect(data.status).toBe('active');
      expect(Array.isArray(data.roles)).toBe(true);
      createdId = data.uuid;
    });

    it('should expose the auto-created credentials with default password', async () => {
      const response = await fetch(`${BASE_URL}/${createdId}/credentials`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.username).toBe(familyA);
      expect(data.password).toBe('Itsmyskool@123');
      expect(data.mustChangePassword).toBe(true);
    });

    it('should create an employee with assigned roles', async () => {
      const response = await fetch(createUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Test Admin',
          familyUniqueNumber: familyB,
          roleIds: [adminRoleId],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      createdWithRoleId = data.uuid;
      expect(data.roles.map((r: any) => r.code)).toContain('admin');
    });

    it('should return 400 when name is missing', async () => {
      const response = await fetch(createUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ familyUniqueNumber: `${stamp}X` }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 when familyUniqueNumber is missing', async () => {
      const response = await fetch(createUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'No Family Number' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for duplicate familyUniqueNumber', async () => {
      const response = await fetch(createUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Duplicate', familyUniqueNumber: familyA }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /employee/{id}', () => {
    it('should get an employee with roles', async () => {
      const response = await fetch(`${BASE_URL}/${createdId}`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdId);
      expect(data.name).toBe('Test Teacher');
      expect(Array.isArray(data.roles)).toBe(true);
    });

    it('should return 404 for non-existent employee', async () => {
      const response = await fetch(`${BASE_URL}/nonexistent1`, { method: 'GET', headers });
      expect(response.status).toBe(404);
    });
  });

  describe('PUT /employee/{id}', () => {
    it('should update name and reconcile roles', async () => {
      const response = await fetch(`${BASE_URL}/${createdId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name: 'Test Teacher Updated', roleIds: [adminRoleId] }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe('Test Teacher Updated');
      expect(data.roles.map((r: any) => r.code)).toContain('admin');
    });

    it('should return 404 when updating a non-existent employee', async () => {
      const response = await fetch(`${BASE_URL}/nonexistent1`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name: 'X' }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('POST /employee/{id}/reset-password', () => {
    it('should reset the password to default', async () => {
      const response = await fetch(`${BASE_URL}/${createdId}/reset-password`, { method: 'POST', headers });
      expect(response.status).toBe(200);

      const creds = await (await fetch(`${BASE_URL}/${createdId}/credentials`, { method: 'GET', headers })).json();
      expect(creds.password).toBe('Itsmyskool@123');
      expect(creds.mustChangePassword).toBe(true);
    });
  });

  describe('GET /employee/search', () => {
    it('should find the created employee by name', async () => {
      const response = await fetch(`${searchUrl}?name=Test Teacher Updated`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.some((e: any) => e.uuid === createdId)).toBe(true);
    });

    it('should return 400 for missing X-School-Code header', async () => {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /employee/{id}', () => {
    it('should soft-delete the employee and remove the login', async () => {
      const response = await fetch(`${BASE_URL}/${createdId}`, { method: 'DELETE', headers });
      expect(response.status).toBe(200);

      const detail = await fetch(`${BASE_URL}/${createdId}`, { method: 'GET', headers });
      expect(detail.status).toBe(404);

      const creds = await fetch(`${BASE_URL}/${createdId}/credentials`, { method: 'GET', headers });
      expect(creds.status).toBe(404);
    });

    it('should not list the deleted employee in search', async () => {
      const response = await fetch(`${searchUrl}?name=Test Teacher Updated`, { method: 'GET', headers });
      const data = await response.json();
      expect(data.some((e: any) => e.uuid === createdId)).toBe(false);
    });

    it('should return 404 when deleting a non-existent employee', async () => {
      const response = await fetch(`${BASE_URL}/nonexistent1`, { method: 'DELETE', headers });
      expect(response.status).toBe(404);
    });

    it('should clean up the role-assigned employee', async () => {
      const response = await fetch(`${BASE_URL}/${createdWithRoleId}`, { method: 'DELETE', headers });
      expect(response.status).toBe(200);
    });
  });

  describe('GET /employee/search?includeDeleted=true', () => {
    it('should include deleted employees when requested', async () => {
      const response = await fetch(`${searchUrl}?includeDeleted=true`, { method: 'GET', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      const deleted = data.find((e: any) => e.uuid === createdId);
      expect(deleted).toBeDefined();
      expect(deleted.status).toBe('deleted');
    });
  });

  describe('POST /employee/{id}/restore', () => {
    it('should restore a deleted employee and re-create the login', async () => {
      const response = await fetch(`${BASE_URL}/${createdId}/restore`, { method: 'POST', headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('active');

      const detail = await fetch(`${BASE_URL}/${createdId}`, { method: 'GET', headers });
      expect(detail.status).toBe(200);

      const creds = await fetch(`${BASE_URL}/${createdId}/credentials`, { method: 'GET', headers });
      expect(creds.status).toBe(200);
      const credData = await creds.json();
      expect(credData.username).toBe(familyA);
      expect(credData.mustChangePassword).toBe(true);
    });

    it('should return 404 when restoring a non-deleted employee', async () => {
      const response = await fetch(`${BASE_URL}/${createdId}/restore`, { method: 'POST', headers });
      expect(response.status).toBe(404);
    });

    it('should clean up the restored employee', async () => {
      const response = await fetch(`${BASE_URL}/${createdId}`, { method: 'DELETE', headers });
      expect(response.status).toBe(200);
    });
  });
});
