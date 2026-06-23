import { BASE_URL, headers, createItem, uniqueName } from './helpers';

describe('Supplies Category API', () => {
  const url = `${BASE_URL}/categories`;
  let createdId: string;

  it('creates a category (deriving a code from the name)', async () => {
    const name = uniqueName('Lab Coats');
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ name }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.uuid).toBeDefined();
    expect(data.name).toBe(name);
    expect(data.code).toMatch(/^[a-z0-9_]+$/);
    createdId = data.uuid;
  });

  it('lists categories including the new one', async () => {
    const res = await fetch(url, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.categories.some((c: any) => c.uuid === createdId)).toBe(true);
  });

  it('updates a category name', async () => {
    const res = await fetch(`${url}/${createdId}`, {
      method: 'PUT', headers, body: JSON.stringify({ name: 'Lab Aprons' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('Lab Aprons');
  });

  it('blocks deleting a category that still has items', async () => {
    await createItem({ categoryId: createdId, name: uniqueName('Apron Cotton'), unit: 'piece' });
    const res = await fetch(`${url}/${createdId}`, { method: 'DELETE', headers });
    expect(res.status).toBe(400);
  });

  it('deletes an empty category', async () => {
    const name = uniqueName('Temp Category');
    const created = await (await fetch(url, { method: 'POST', headers, body: JSON.stringify({ name }) })).json();
    const res = await fetch(`${url}/${created.uuid}`, { method: 'DELETE', headers });
    expect(res.status).toBe(200);
    const after = await fetch(`${url}/${created.uuid}`, { headers });
    expect(after.status).toBe(404);
  });
});
