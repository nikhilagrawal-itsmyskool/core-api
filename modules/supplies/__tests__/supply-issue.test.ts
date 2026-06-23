import { BASE_URL, headers, categoryIdByCode, createItem, getItem, uniqueName } from './helpers';

describe('Supplies Issue API', () => {
  const issuesUrl = `${BASE_URL}/issues`;
  let itemId: string;
  let issueId: string;

  beforeAll(async () => {
    const categoryId = await categoryIdByCode('other');
    const item = await createItem({ categoryId, name: uniqueName('Issuable Item'), unit: 'piece' });
    itemId = item.uuid;
    // Stock it via a bulk purchase.
    await fetch(`${BASE_URL}/purchases/bulk`, {
      method: 'POST', headers,
      body: JSON.stringify({ purchaseDate: '2026-02-01', items: [{ itemId, quantity: 20 }] }),
    });
  });

  it('issues stock (decrementing current stock)', async () => {
    const res = await fetch(issuesUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ itemId, issueDate: '2026-02-02', quantity: 5, issueType: 'class_use', issuedTo: 'Class 5A' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    issueId = data.uuid;
    expect((await getItem(itemId)).currentStock).toBe(15);
  });

  it('rejects an issue for a non-existent item', async () => {
    const res = await fetch(issuesUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ itemId: 'nonexistent1', issueDate: '2026-02-02', quantity: 1, issueType: 'class_use' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns issued stock in good condition (restoring stock)', async () => {
    const res = await fetch(`${issuesUrl}/${issueId}/return`, {
      method: 'PUT', headers,
      body: JSON.stringify({ returnDate: '2026-02-10', returnCondition: 'good' }),
    });
    expect(res.status).toBe(200);
    expect((await getItem(itemId)).currentStock).toBe(20);
  });

  it('lists issues within a date range', async () => {
    const res = await fetch(`${issuesUrl}?startDate=2026-02-01&endDate=2026-02-28`, { headers });
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});
