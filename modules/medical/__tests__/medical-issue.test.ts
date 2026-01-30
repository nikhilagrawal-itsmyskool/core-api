import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

// Load module config - use GATEWAY_PORT env var if set, otherwise use module port
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Medical Issue API', () => {
  const itemsUrl = `${BASE_URL}/items`;
  const purchasesUrl = `${BASE_URL}/purchases`;
  const issuesUrl = `${BASE_URL}/issues`;

  let testItemId: string;
  let createdIssueId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  // Create a test item and add stock before running issue tests
  beforeAll(async () => {
    // Create item
    const itemResponse = await fetch(itemsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Test Medicine for Issue',
        unit: 'tablet',
        reorderLevel: 20,
      }),
    });
    const itemData = await itemResponse.json();
    testItemId = itemData.uuid;

    // Add stock via purchase
    await fetch(purchasesUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        itemId: testItemId,
        purchaseDate: '2025-01-07',
        quantity: 100,
      }),
    });
  });

  // Clean up test item after tests
  afterAll(async () => {
    if (testItemId) {
      await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'DELETE',
        headers,
      });
    }
  });

  describe('POST /medical/issues', () => {
    it('should create an issue and decrease stock', async () => {
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          issueDate: '2025-01-07',
          entityType: 'student',
          entityId: 'student12345',
          quantity: 2,
          remarks: 'Headache',
          parentConsent: true,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('uuid');
      expect(data.itemId).toBe(testItemId);
      expect(data.itemName).toBe('Test Medicine for Issue');
      expect(data.entityType).toBe('student');
      expect(data.quantity).toBe(2);
      expect(data.parentConsent).toBe(true);
      expect(data.status).toBe('active');

      createdIssueId = data.uuid;

      // Verify stock was decreased (100 - 2 = 98)
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(98);
    });

    it('should use default quantity of 1 if not specified', async () => {
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          issueDate: '2025-01-07',
          entityType: 'employee',
          entityId: 'employee123',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.quantity).toBe(1);

      // Clean up this issue
      await fetch(`${issuesUrl}/${data.uuid}`, {
        method: 'DELETE',
        headers,
      });
    });

    it('should return 400 for invalid entityType', async () => {
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          issueDate: '2025-01-07',
          entityType: 'invalid_type',
          entityId: 'test123',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing entityId', async () => {
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          issueDate: '2025-01-07',
          entityType: 'student',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /medical/issues/{id}', () => {
    it('should get issue by ID', async () => {
      const response = await fetch(`${issuesUrl}/${createdIssueId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdIssueId);
      expect(data.itemId).toBe(testItemId);
      expect(data.itemName).toBe('Test Medicine for Issue');
    });

    it('should return 404 for non-existent issue', async () => {
      const response = await fetch(`${issuesUrl}/nonexistent1`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /medical/issues', () => {
    it('should list issues with no parameters (default date range)', async () => {
      const response = await fetch(issuesUrl, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should list issues by itemId', async () => {
      // Include date range that covers test data
      const response = await fetch(
        `${issuesUrl}?itemId=${testItemId}&startDate=2025-01-01&endDate=2030-12-31`,
        {
          method: 'GET',
          headers,
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].itemId).toBe(testItemId);
      expect(data[0].itemName).toBe('Test Medicine for Issue');
    });

    it('should list issues by entityType only', async () => {
      const response = await fetch(`${issuesUrl}?entityType=student`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      // All returned issues should have entityType = 'student'
      data.forEach((issue: any) => {
        expect(issue.entityType).toBe('student');
      });
    });

    it('should list issues by entityType and entityId', async () => {
      // Include date range that covers test data
      const response = await fetch(
        `${issuesUrl}?entityType=student&entityId=student12345&startDate=2025-01-01&endDate=2030-12-31`,
        {
          method: 'GET',
          headers,
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].entityType).toBe('student');
      expect(data[0].entityId).toBe('student12345');
    });

    it('should list issues with custom date range', async () => {
      const response = await fetch(
        `${issuesUrl}?startDate=2025-01-01&endDate=2025-12-31`,
        {
          method: 'GET',
          headers,
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should return 400 for invalid startDate format', async () => {
      const response = await fetch(`${issuesUrl}?startDate=invalid`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid endDate format', async () => {
      const response = await fetch(`${issuesUrl}?endDate=01-01-2025`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid entityType', async () => {
      const response = await fetch(`${issuesUrl}?entityType=invalid`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(400);
    });

    it('should exclude deleted issues by default', async () => {
      // Create an issue
      const createResponse = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          issueDate: '2025-01-08',
          entityType: 'student',
          entityId: 'stu-del-tst', // 11 chars to fit varchar(12)
          quantity: 1,
        }),
      });
      expect(createResponse.status).toBe(200);
      const createdIssue = await createResponse.json();
      expect(createdIssue.uuid).toBeDefined();

      // Delete the issue
      const deleteResponse = await fetch(`${issuesUrl}/${createdIssue.uuid}`, {
        method: 'DELETE',
        headers,
      });
      expect(deleteResponse.status).toBe(200);

      // List without includeDeleted - should not find the deleted issue
      const listResponse = await fetch(
        `${issuesUrl}?itemId=${testItemId}&startDate=2025-01-01&endDate=2030-12-31`,
        {
          method: 'GET',
          headers,
        }
      );

      expect(listResponse.status).toBe(200);
      const results = await listResponse.json();
      const found = results.find((i: any) => i.uuid === createdIssue.uuid);
      expect(found).toBeUndefined();
    });

    it('should include deleted issues when includeDeleted=true', async () => {
      // Create an issue
      const createResponse = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          issueDate: '2025-01-09',
          entityType: 'student',
          entityId: 'stu-inc-tst', // 11 chars to fit varchar(12)
          quantity: 1,
        }),
      });
      expect(createResponse.status).toBe(200);
      const createdIssue = await createResponse.json();
      expect(createdIssue.uuid).toBeDefined();

      // Delete the issue
      const deleteResponse = await fetch(`${issuesUrl}/${createdIssue.uuid}`, {
        method: 'DELETE',
        headers,
      });
      expect(deleteResponse.status).toBe(200);

      // List with includeDeleted=true - should find the deleted issue
      const listResponse = await fetch(
        `${issuesUrl}?itemId=${testItemId}&startDate=2025-01-01&endDate=2030-12-31&includeDeleted=true`,
        {
          method: 'GET',
          headers,
        }
      );

      expect(listResponse.status).toBe(200);
      const results = await listResponse.json();
      const found = results.find((i: any) => i.uuid === createdIssue.uuid);
      expect(found).toBeDefined();
      expect(found.status).toBe('deleted');
    });
  });

  describe('PUT /medical/issues/{id}', () => {
    it('should update issue and adjust stock', async () => {
      // Update quantity from 2 to 5 (should decrease stock by 3 more)
      const response = await fetch(`${issuesUrl}/${createdIssueId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          quantity: 5,
          remarks: 'Updated - severe headache',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.quantity).toBe(5);
      expect(data.remarks).toBe('Updated - severe headache');

      // Verify stock was adjusted (98 - 3 = 95)
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(95);
    });
  });

  describe('DELETE /medical/issues/{id}', () => {
    it('should delete issue and restore stock', async () => {
      const response = await fetch(`${issuesUrl}/${createdIssueId}`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(200);

      // Verify stock was restored (95 + 5 = 100)
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(100);
    });

    it('should return 404 for deleting non-existent issue', async () => {
      const response = await fetch(`${issuesUrl}/nonexistent1`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });
});
