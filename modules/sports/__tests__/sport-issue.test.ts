import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Sport Issue API', () => {
  const itemsUrl = `${BASE_URL}/items`;
  const purchasesUrl = `${BASE_URL}/purchases`;
  const issuesUrl = `${BASE_URL}/issues`;

  const testSportType = 'cricket';
  let testItemId: string;
  let createdIssueId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  beforeAll(async () => {
    // Create test item
    const itemResponse = await fetch(itemsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sportType: testSportType,
        name: 'HCl Solution',
        itemType: 'consumable',
        unit: 'bottle',
        category: 'Chemicals',
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
        sportType: testSportType,
        purchaseDate: '2026-01-01',
        quantity: 50,
      }),
    });
  });

  afterAll(async () => {
    if (testItemId) {
      await fetch(`${itemsUrl}/${testItemId}`, { method: 'DELETE', headers });
    }
  });

  describe('POST /sport/issues', () => {
    it('should create an issue and decrease stock', async () => {
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          sportType: testSportType,
          issueDate: '2026-02-01',
          quantity: 5,
          issueType: 'class_use',
          issuedTo: 'Class 10-A',
          purpose: 'Chemistry practical - acid-base titration',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('uuid');
      expect(data.itemId).toBe(testItemId);
      expect(data.itemName).toBe('HCl Solution');
      expect(data.quantity).toBe(5);
      expect(data.issueType).toBe('class_use');
      expect(data.returned).toBe(false);

      createdIssueId = data.uuid;

      // Verify stock was decreased (50 - 5 = 45)
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(45);
    });

    it('should return 400 for missing issue type', async () => {
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          sportType: testSportType,
          issueDate: '2026-02-01',
          quantity: 1,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid issue type', async () => {
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          sportType: testSportType,
          issueDate: '2026-02-01',
          quantity: 1,
          issueType: 'invalid',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /sport/issues/{id}', () => {
    it('should get issue by ID', async () => {
      const response = await fetch(`${issuesUrl}/${createdIssueId}`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdIssueId);
      expect(data.itemName).toBe('HCl Solution');
    });

    it('should return 404 for non-existent issue', async () => {
      const response = await fetch(`${issuesUrl}/nonexistent1`, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /sport/issues', () => {
    it('should list issues with date range', async () => {
      const response = await fetch(
        `${issuesUrl}?sportType=${testSportType}&startDate=2026-01-01&endDate=2026-12-31`,
        { method: 'GET', headers }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should filter by issue type', async () => {
      const response = await fetch(
        `${issuesUrl}?issueType=class_use&startDate=2026-01-01&endDate=2026-12-31`,
        { method: 'GET', headers }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach((issue: any) => {
        expect(issue.issueType).toBe('class_use');
      });
    });
  });

  describe('PUT /sport/issues/{id}', () => {
    it('should update issue and adjust stock', async () => {
      const response = await fetch(`${issuesUrl}/${createdIssueId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          quantity: 10,
          purpose: 'Updated purpose',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.quantity).toBe(10);

      // Verify stock adjusted (45 + 5 - 10 = 40)
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(40);
    });
  });

  describe('PUT /sport/issues/{id}/return', () => {
    let returnableIssueId: string;

    beforeAll(async () => {
      // Create an individual issue for return testing
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: testItemId,
          sportType: testSportType,
          issueDate: '2026-02-05',
          quantity: 2,
          issueType: 'individual',
          issuedTo: 'Mr. Kumar',
          expectedReturnDate: '2026-02-10',
        }),
      });
      const data = await response.json();
      returnableIssueId = data.uuid;
    });

    it('should return item and restore stock (good condition)', async () => {
      // Stock before: 40 - 2 = 38 (after issue creation)
      const response = await fetch(`${issuesUrl}/${returnableIssueId}/return`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          returnDate: '2026-02-08',
          returnCondition: 'good',
          returnRemarks: 'Returned in good condition',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.returned).toBe(true);
      expect(data.returnCondition).toBe('good');

      // Stock should be restored (38 + 2 = 40)
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(40);
    });

    it('should return 400 for missing return condition', async () => {
      const response = await fetch(`${issuesUrl}/${createdIssueId}/return`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          returnDate: '2026-02-08',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /sport/issues/{id}', () => {
    it('should delete issue and restore stock', async () => {
      const response = await fetch(`${issuesUrl}/${createdIssueId}`, {
        method: 'DELETE',
        headers,
      });

      expect(response.status).toBe(200);

      // Stock restored (40 + 10 = 50)
      const itemResponse = await fetch(`${itemsUrl}/${testItemId}`, {
        method: 'GET',
        headers,
      });
      const itemData = await itemResponse.json();
      expect(itemData.currentStock).toBe(50);
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
