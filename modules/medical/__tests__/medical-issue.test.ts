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
        reorder_level: 20,
      }),
    });
    const itemData = await itemResponse.json();
    testItemId = itemData.uuid;

    // Add stock via purchase
    await fetch(purchasesUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        item_id: testItemId,
        purchase_date: '2025-01-07',
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
          item_id: testItemId,
          issue_date: '2025-01-07',
          entity_type: 'student',
          entity_id: 'student12345',
          quantity: 2,
          remarks: 'Headache',
          parent_consent: true,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('uuid');
      expect(data.item_id).toBe(testItemId);
      expect(data.entity_type).toBe('student');
      expect(data.quantity).toBe(2);
      expect(data.parent_consent).toBe(true);
      expect(data.status).toBe('active');

      createdIssueId = data.uuid;

      // Verify stock was decreased (100 - 2 = 98)
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.current_stock).toBe(98);
    });

    it('should use default quantity of 1 if not specified', async () => {
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          item_id: testItemId,
          issue_date: '2025-01-07',
          entity_type: 'employee',
          entity_id: 'employee123',
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

    it('should return 400 for invalid entity_type', async () => {
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          item_id: testItemId,
          issue_date: '2025-01-07',
          entity_type: 'invalid_type',
          entity_id: 'test123',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing entity_id', async () => {
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          item_id: testItemId,
          issue_date: '2025-01-07',
          entity_type: 'student',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /medical/issues', () => {
    it('should list issues by item_id', async () => {
      const response = await fetch(`${issuesUrl}?item_id=${testItemId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].item_id).toBe(testItemId);
    });

    it('should list issues by entity', async () => {
      const response = await fetch(
        `${issuesUrl}?entity_type=student&entity_id=student12345`,
        {
          method: 'GET',
          headers,
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].entity_type).toBe('student');
      expect(data[0].entity_id).toBe('student12345');
    });

    it('should return 400 for missing query parameters', async () => {
      const response = await fetch(issuesUrl, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(400);
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
      expect(itemData.current_stock).toBe(95);
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
      expect(itemData.current_stock).toBe(100);
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
