import { BASE_URL, headers, categoryIdByCode, createItem, getItem, uniqueName } from './helpers';

describe('Supplies Bulk Purchase API', () => {
  const purchasesUrl = `${BASE_URL}/purchases`;
  let categoryId: string;
  let existingItemId: string;
  let batchId: string;

  beforeAll(async () => {
    categoryId = await categoryIdByCode('other');
    const item = await createItem({ categoryId, name: uniqueName('Pre-existing Item'), unit: 'piece' });
    existingItemId = item.uuid;
  });

  it('creates a bulk purchase with an existing item AND an inline new item, updating stock', async () => {
    const newName = uniqueName('Inline Created Item');
    const res = await fetch(`${purchasesUrl}/bulk`, {
      method: 'POST', headers,
      body: JSON.stringify({
        purchaseDate: '2026-01-15',
        supplier: 'ABC Traders',
        invoiceNumber: 'INV-001',
        items: [
          { itemId: existingItemId, quantity: 10, costPerUnit: 5 },
          { newItem: { name: newName, categoryId, unit: 'box' }, quantity: 4, costPerUnit: 20 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const batch = await res.json();
    expect(batch.uuid).toBeDefined();
    expect(batch.items.length).toBe(2);
    batchId = batch.uuid;

    // Existing item stock incremented.
    const existing = await getItem(existingItemId);
    expect(existing.currentStock).toBe(10);

    // Inline item now exists with the purchased stock.
    const search = await (await fetch(`${BASE_URL}/items?categoryId=${categoryId}&search=${encodeURIComponent(newName)}`, { headers })).json();
    const created = search.find((i: any) => i.name === newName);
    expect(created).toBeDefined();
    expect(created.currentStock).toBe(4);
  });

  it('aborts the whole batch (needsConfirmation, no writes) when a new-item line is a near-match', async () => {
    const guardName = uniqueName('Guarded Item');
    const guarded = await createItem({ categoryId, name: guardName, unit: 'piece' });
    const stockBefore = (await getItem(guarded.uuid)).currentStock;

    const typo = guardName.replace('Guarded', 'Guardeo'); // 1-edit near match
    const res = await fetch(`${purchasesUrl}/bulk`, {
      method: 'POST', headers,
      body: JSON.stringify({
        purchaseDate: '2026-01-16',
        items: [
          { itemId: existingItemId, quantity: 3 },
          { newItem: { name: typo, categoryId, unit: 'piece' }, quantity: 7 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.needsConfirmation).toBe(true);
    expect(data.conflicts[0].lineIndex).toBe(1);

    // No writes: the existing-item line (index 0) did NOT increment stock.
    const guardedAfter = await getItem(guarded.uuid);
    expect(guardedAfter.currentStock).toBe(stockBefore);
  });

  it('creates the batch when the near-match line is confirmed', async () => {
    const guardName = uniqueName('Confirm Item');
    await createItem({ categoryId, name: guardName, unit: 'piece' });
    const typo = guardName.replace('Confirm', 'Konfirm');
    const res = await fetch(`${purchasesUrl}/bulk`, {
      method: 'POST', headers,
      body: JSON.stringify({
        purchaseDate: '2026-01-17',
        items: [{ newItem: { name: typo, categoryId, unit: 'piece' }, confirmNewItem: true, quantity: 2 }],
      }),
    });
    expect(res.status).toBe(200);
    const batch = await res.json();
    expect(batch.needsConfirmation).toBeUndefined();
    expect(batch.items.length).toBe(1);
  });

  it('lists purchase batches', async () => {
    const res = await fetch(purchasesUrl, { headers });
    expect(res.status).toBe(200);
    const batches = await res.json();
    expect(Array.isArray(batches)).toBe(true);
    expect(batches.some((b: any) => b.uuid === batchId)).toBe(true);
  });

  it('deletes then restores a batch, reversing and re-applying stock', async () => {
    const before = (await getItem(existingItemId)).currentStock;

    const del = await fetch(`${purchasesUrl}/${batchId}`, { method: 'DELETE', headers });
    expect(del.status).toBe(200);
    expect((await getItem(existingItemId)).currentStock).toBe(before - 10);

    const restore = await fetch(`${purchasesUrl}/${batchId}/restore`, { method: 'POST', headers });
    expect(restore.status).toBe(200);
    expect((await getItem(existingItemId)).currentStock).toBe(before);
  });
});
