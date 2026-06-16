import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Lab Purchase Batch Update API', () => {
  const labsUrl = `${BASE_URL}/labs`;
  const itemsUrl = `${BASE_URL}/items`;
  const purchasesUrl = `${BASE_URL}/purchases`;
  const batchesUrl = `${BASE_URL}/purchases/batches`;

  let testLabId: string;
  let itemA: string;
  let itemB: string;
  let itemC: string;
  let itemD: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  const createItem = async (name: string): Promise<string> => {
    const res = await fetch(itemsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        labId: testLabId,
        name,
        itemType: 'equipment',
        unit: 'piece',
        category: 'Glassware',
        reorderLevel: 5,
      }),
    });
    const data = await res.json();
    return data.uuid;
  };

  const getStock = async (itemId: string): Promise<number> => {
    const res = await fetch(`${itemsUrl}/${itemId}`, { method: 'GET', headers });
    const data = await res.json();
    return data.currentStock;
  };

  beforeAll(async () => {
    const labResponse = await fetch(labsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Test Lab for Batch Update', type: 'chemistry' }),
    });
    const labData = await labResponse.json();
    testLabId = labData.uuid;

    itemA = await createItem('Batch Item A');
    itemB = await createItem('Batch Item B');
    itemC = await createItem('Batch Item C');
    itemD = await createItem('Batch Item D');
  });

  afterAll(async () => {
    for (const id of [itemA, itemB, itemC, itemD]) {
      if (id) await fetch(`${itemsUrl}/${id}`, { method: 'DELETE', headers });
    }
    if (testLabId) await fetch(`${labsUrl}/${testLabId}`, { method: 'DELETE', headers });
  });

  describe('PUT /lab/purchases/batches/{batchId} - full item editing', () => {
    let batchId: string;
    let rowA: string;

    it('creates a batch with two items', async () => {
      const res = await fetch(`${purchasesUrl}/bulk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchaseDate: '2026-02-01',
          supplier: 'Initial Supplier',
          items: [
            { itemId: itemA, labId: testLabId, quantity: 10, costPerUnit: 100 },
            { itemId: itemB, labId: testLabId, quantity: 5, costPerUnit: 50 },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      batchId = data.uuid;
      expect(data.recordType).toBe('batch');

      rowA = data.items.find((i: any) => i.itemId === itemA).uuid;

      expect(await getStock(itemA)).toBe(10);
      expect(await getStock(itemB)).toBe(5);
    });

    it('edits qty of one item, deletes another, and adds a new item atomically', async () => {
      const res = await fetch(`${batchesUrl}/${batchId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          supplier: 'Updated Supplier',
          items: [
            // itemA kept, quantity 10 -> 15
            { uuid: rowA, itemId: itemA, labId: testLabId, quantity: 15, costPerUnit: 100 },
            // itemB omitted -> deleted
            // itemC new
            { itemId: itemC, labId: testLabId, quantity: 7, costPerUnit: 70 },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.supplier).toBe('Updated Supplier');

      const activeItems = (data.items || []).filter((i: any) => i.status === 'active');
      expect(activeItems.length).toBe(2);

      // Stock: A 10->15 (+5), B 5->0 (deleted, -5), C new +7
      expect(await getStock(itemA)).toBe(15);
      expect(await getStock(itemB)).toBe(0);
      expect(await getStock(itemC)).toBe(7);
    });

    it('rejects an item with quantity <= 0', async () => {
      const res = await fetch(`${batchesUrl}/${batchId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          items: [{ itemId: itemA, labId: testLabId, quantity: 0 }],
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /lab/purchases/batches/{batchId} - legacy purchase upgrade', () => {
    let legacyId: string;

    it('creates a legacy single purchase', async () => {
      const res = await fetch(purchasesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: itemD,
          labId: testLabId,
          purchaseDate: '2026-03-01',
          quantity: 20,
          costPerUnit: 200,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      legacyId = data.uuid;
      expect(await getStock(itemD)).toBe(20);
    });

    it('upgrades the legacy purchase into a batch on edit', async () => {
      const res = await fetch(`${batchesUrl}/${legacyId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          supplier: 'Upgraded Supplier',
          items: [
            // keep the legacy row (its uuid == legacyId), qty 20 -> 25
            { uuid: legacyId, itemId: itemD, labId: testLabId, quantity: 25, costPerUnit: 200 },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.recordType).toBe('batch');
      expect(data.uuid).not.toBe(legacyId); // a fresh batch header id
      expect(data.supplier).toBe('Upgraded Supplier');

      // Stock: D 20 -> 25 (+5)
      expect(await getStock(itemD)).toBe(25);
    });
  });
});
