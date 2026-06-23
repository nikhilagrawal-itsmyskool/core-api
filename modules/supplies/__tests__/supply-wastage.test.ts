import { BASE_URL, headers, categoryIdByCode, createItem, getItem, uniqueName } from './helpers';

describe('Supplies Wastage API', () => {
  const wastagesUrl = `${BASE_URL}/wastages`;
  let itemId: string;
  let wastageId: string;

  beforeAll(async () => {
    const categoryId = await categoryIdByCode('other');
    const item = await createItem({ categoryId, name: uniqueName('Wastable Item'), unit: 'bottle' });
    itemId = item.uuid;
    await fetch(`${BASE_URL}/purchases/bulk`, {
      method: 'POST', headers,
      body: JSON.stringify({ purchaseDate: '2026-03-01', items: [{ itemId, quantity: 12 }] }),
    });
  });

  it('records wastage (decrementing stock)', async () => {
    const res = await fetch(wastagesUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ itemId, wastageDate: '2026-03-05', quantity: 3, reason: 'expired', actionTaken: 'written_off' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    wastageId = data.uuid;
    expect(data.reason).toBe('expired');
    expect((await getItem(itemId)).currentStock).toBe(9);
  });

  it('rejects an invalid reason', async () => {
    const res = await fetch(wastagesUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ itemId, wastageDate: '2026-03-05', quantity: 1, reason: 'nonsense' }),
    });
    expect(res.status).toBe(400);
  });

  it('deletes a wastage record (restoring stock)', async () => {
    const res = await fetch(`${wastagesUrl}/${wastageId}`, { method: 'DELETE', headers });
    expect(res.status).toBe(200);
    expect((await getItem(itemId)).currentStock).toBe(12);
  });

  it('lists wastages within a date range', async () => {
    const res = await fetch(`${wastagesUrl}?startDate=2026-03-01&endDate=2026-03-31`, { headers });
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});
