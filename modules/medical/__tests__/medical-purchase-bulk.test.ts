import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Medical Purchase Bulk API', () => {
  const itemsUrl = `${BASE_URL}/items`;
  const purchasesUrl = `${BASE_URL}/purchases`;
  const batchesUrl = `${BASE_URL}/purchases/batches`;

  let testItemId1: string;
  let testItemId2: string;
  let testItemId3: string;
  let createdBatchId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  // A tiny valid PNG (1×1 transparent pixel) as base64
  const TINY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  beforeAll(async () => {
    const createItem = async (name: string) => {
      const res = await fetch(itemsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, unit: 'tablet', reorderLevel: 10 }),
      });
      const data = await res.json();
      return data.uuid as string;
    };

    testItemId1 = await createItem('Bulk Item Alpha');
    testItemId2 = await createItem('Bulk Item Beta');
    testItemId3 = await createItem('Bulk Item Gamma');
  });

  afterAll(async () => {
    for (const id of [testItemId1, testItemId2, testItemId3]) {
      if (id) {
        await fetch(`${itemsUrl}/${id}`, { method: 'DELETE', headers });
      }
    }
  });

  describe('POST /medical/purchases/bulk', () => {
    it('should create a batch with 3 items and update stock for each', async () => {
      const response = await fetch(`${purchasesUrl}/bulk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchaseDate: '2025-06-01',
          supplier: 'Bulk Pharma',
          invoiceNumber: 'BULK-INV-001',
          batchNo: 'LOT-HEADER',
          items: [
            { itemId: testItemId1, quantity: 50, costPerUnit: 2.5 },
            { itemId: testItemId2, quantity: 30 },
            { itemId: testItemId3, quantity: 20, batchNo: 'LOT-ITEM3' },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.supplier).toBe('Bulk Pharma');
      expect(data.invoiceNumber).toBe('BULK-INV-001');
      expect(data.status).toBe('active');
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBe(3);

      createdBatchId = data.uuid;

      // Verify stock was updated for all 3 items
      const [r1, r2, r3] = await Promise.all([
        fetch(`${itemsUrl}/${testItemId1}`, { headers }).then((r) => r.json()),
        fetch(`${itemsUrl}/${testItemId2}`, { headers }).then((r) => r.json()),
        fetch(`${itemsUrl}/${testItemId3}`, { headers }).then((r) => r.json()),
      ]);
      expect(r1.currentStock).toBe(50);
      expect(r2.currentStock).toBe(30);
      expect(r3.currentStock).toBe(20);

      // Verify per-item batchNo inheritance
      const item3 = data.items.find((i: any) => i.itemId === testItemId3);
      expect(item3.batchNo).toBe('LOT-ITEM3');
      const item1 = data.items.find((i: any) => i.itemId === testItemId1);
      expect(item1.batchNo).toBe('LOT-HEADER');
    });

    it('should return 400 for empty items array', async () => {
      const response = await fetch(`${purchasesUrl}/bulk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchaseDate: '2025-06-01',
          items: [],
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for missing purchaseDate', async () => {
      const response = await fetch(`${purchasesUrl}/bulk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          items: [{ itemId: testItemId1, quantity: 10 }],
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid itemId', async () => {
      const response = await fetch(`${purchasesUrl}/bulk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchaseDate: '2025-06-01',
          items: [{ itemId: 'doesnotexist', quantity: 10 }],
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for quantity: 0', async () => {
      const response = await fetch(`${purchasesUrl}/bulk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchaseDate: '2025-06-01',
          items: [{ itemId: testItemId1, quantity: 0 }],
        }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /medical/purchases/batches', () => {
    it('should return an array of batches', async () => {
      const response = await fetch(batchesUrl, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should include the created batch in the list', async () => {
      const response = await fetch(
        `${batchesUrl}?startDate=2025-01-01&endDate=2030-12-31`,
        { headers }
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      const found = data.find((b: any) => b.uuid === createdBatchId);
      expect(found).toBeDefined();
    });
  });

  describe('GET /medical/purchases/batches/{batchId}', () => {
    it('should return batch with items array', async () => {
      const response = await fetch(`${batchesUrl}/${createdBatchId}`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdBatchId);
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBe(3);
    });

    it('should return 404 for nonexistent batch', async () => {
      const response = await fetch(`${batchesUrl}/nonexistent1`, { headers });
      expect(response.status).toBe(404);
    });
  });

  describe('PUT /medical/purchases/batches/{batchId}', () => {
    it('should update batch header fields', async () => {
      const response = await fetch(`${batchesUrl}/${createdBatchId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ supplier: 'Updated Pharma', notes: 'Updated notes' }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.supplier).toBe('Updated Pharma');
      expect(data.notes).toBe('Updated notes');
    });
  });

  describe('Bill upload / retrieve / delete', () => {
    it('should upload a bill and set fileId on the batch', async () => {
      const response = await fetch(`${batchesUrl}/${createdBatchId}/bill`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: 'invoice.png',
          mimeType: 'image/png',
          base64Data: TINY_PNG_BASE64,
        }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.fileId).toBeTruthy();
    });

    it('should retrieve the bill with base64 data', async () => {
      const response = await fetch(`${batchesUrl}/${createdBatchId}/bill`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data).toHaveProperty('fileName', 'invoice.png');
      expect(data).toHaveProperty('mimeType', 'image/png');
      expect(data).toHaveProperty('data');
      expect(data.data).toBe(TINY_PNG_BASE64);
    });

    it('should replace bill when uploading again', async () => {
      // Get the first file's uuid
      const before = await fetch(`${batchesUrl}/${createdBatchId}/bill`, { headers }).then((r) =>
        r.json()
      );
      const oldFileId = before.uuid;

      // Upload a new bill
      await fetch(`${batchesUrl}/${createdBatchId}/bill`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: 'invoice-v2.png',
          mimeType: 'image/png',
          base64Data: TINY_PNG_BASE64,
        }),
      });

      // New bill should have a different uuid
      const after = await fetch(`${batchesUrl}/${createdBatchId}/bill`, { headers }).then((r) =>
        r.json()
      );
      expect(after.uuid).not.toBe(oldFileId);
      expect(after.fileName).toBe('invoice-v2.png');
    });

    it('should return 400 for invalid mimeType on bill upload', async () => {
      const response = await fetch(`${batchesUrl}/${createdBatchId}/bill`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: 'doc.txt',
          mimeType: 'text/plain',
          base64Data: TINY_PNG_BASE64,
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should delete the bill and clear fileId', async () => {
      const deleteResponse = await fetch(`${batchesUrl}/${createdBatchId}/bill`, {
        method: 'DELETE',
        headers,
      });
      expect(deleteResponse.status).toBe(200);

      // fileId should be null on subsequent GET batch
      const batchResponse = await fetch(`${batchesUrl}/${createdBatchId}`, { headers });
      const batch = await batchResponse.json();
      expect(batch.fileId).toBeFalsy();

      // GET bill should 404
      const billResponse = await fetch(`${batchesUrl}/${createdBatchId}/bill`, { headers });
      expect(billResponse.status).toBe(404);
    });
  });

  describe('DELETE /medical/purchases/batches/{batchId}', () => {
    it('should soft-delete the batch and reverse all stock', async () => {
      // Get current stock before delete
      const [s1Before, s2Before, s3Before] = await Promise.all([
        fetch(`${itemsUrl}/${testItemId1}`, { headers }).then((r) => r.json()),
        fetch(`${itemsUrl}/${testItemId2}`, { headers }).then((r) => r.json()),
        fetch(`${itemsUrl}/${testItemId3}`, { headers }).then((r) => r.json()),
      ]);

      const response = await fetch(`${batchesUrl}/${createdBatchId}`, {
        method: 'DELETE',
        headers,
      });
      expect(response.status).toBe(200);

      // Batch should now be soft-deleted, not gone (kept for restore workflow)
      const getResponse = await fetch(`${batchesUrl}/${createdBatchId}`, { headers });
      expect(getResponse.status).toBe(200);
      const deletedBatch = await getResponse.json();
      expect(deletedBatch.status).toBe('deleted');

      // Stock should be reversed
      const [s1After, s2After, s3After] = await Promise.all([
        fetch(`${itemsUrl}/${testItemId1}`, { headers }).then((r) => r.json()),
        fetch(`${itemsUrl}/${testItemId2}`, { headers }).then((r) => r.json()),
        fetch(`${itemsUrl}/${testItemId3}`, { headers }).then((r) => r.json()),
      ]);
      expect(s1After.currentStock).toBe(s1Before.currentStock - 50);
      expect(s2After.currentStock).toBe(s2Before.currentStock - 30);
      expect(s3After.currentStock).toBe(s3Before.currentStock - 20);
    });

    it('should return 404 for deleting nonexistent batch', async () => {
      const response = await fetch(`${batchesUrl}/nonexistent1`, {
        method: 'DELETE',
        headers,
      });
      expect(response.status).toBe(404);
    });
  });
});
