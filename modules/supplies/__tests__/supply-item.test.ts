import { BASE_URL, headers, categoryIdByCode, createItem, uniqueName } from './helpers';

describe('Supplies Item API', () => {
  const itemsUrl = `${BASE_URL}/items`;
  let categoryId: string;
  let createdItemId: string;

  beforeAll(async () => {
    // Use the empty "other" category so the fuzzy guard isn't polluted by the master.
    categoryId = await categoryIdByCode('other');
  });

  describe('POST /supplies/items', () => {
    it('creates a new item', async () => {
      const name = uniqueName('Widget');
      const res = await fetch(itemsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ categoryId, name, unit: 'piece', itemType: 'equipment', reorderLevel: 5 }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('uuid');
      expect(data.name).toBe(name);
      expect(data.currentStock).toBe(0);
      expect(data.reorderLevel).toBe(5);
      expect(data.status).toBe('active');
      createdItemId = data.uuid;
    });

    it('rejects missing unit', async () => {
      const res = await fetch(itemsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ categoryId, name: uniqueName('NoUnit') }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid unit', async () => {
      const res = await fetch(itemsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ categoryId, name: uniqueName('BadUnit'), unit: 'nope' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('item hygiene guard', () => {
    it('auto-reuses an exact (normalized) duplicate instead of creating a new row', async () => {
      const base = uniqueName('Stapler Deluxe');
      const a = await createItem({ categoryId, name: base, unit: 'piece' });
      // Same name with different casing/spacing -> should resolve to the SAME item.
      const res = await fetch(itemsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ categoryId, name: `  ${base.toUpperCase()} `, unit: 'piece' }),
      });
      expect(res.status).toBe(200);
      const b = await res.json();
      expect(b.uuid).toBe(a.uuid);
    });

    it('flags a near-match typo and requires confirmation', async () => {
      const base = uniqueName('Notebook Premium');
      await createItem({ categoryId, name: base, unit: 'piece' });
      // One-character change -> near match -> needsConfirmation.
      const typo = base.replace('Premium', 'Premiun');
      const res = await fetch(itemsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ categoryId, name: typo, unit: 'piece' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.needsConfirmation).toBe(true);
      expect(data.conflicts[0].candidates.length).toBeGreaterThan(0);
    });

    it('creates the near-match item when confirmNewItem is set', async () => {
      const base = uniqueName('Folder Special');
      await createItem({ categoryId, name: base, unit: 'piece' });
      const typo = base.replace('Special', 'Speciol');
      const res = await fetch(itemsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ categoryId, name: typo, unit: 'piece', confirmNewItem: true }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.uuid).toBeDefined();
      expect(data.name).toBe(typo);
    });
  });

  describe('GET /supplies/items', () => {
    it('gets item by id', async () => {
      const res = await fetch(`${itemsUrl}/${createdItemId}`, { headers });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.uuid).toBe(createdItemId);
      expect(data.categoryName).toBeDefined();
    });

    it('returns 404 for a non-existent item', async () => {
      const res = await fetch(`${itemsUrl}/nonexistent1`, { headers });
      expect(res.status).toBe(404);
    });

    it('filters by categoryId', async () => {
      const res = await fetch(`${itemsUrl}?categoryId=${categoryId}`, { headers });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach((it: any) => expect(it.categoryId).toBe(categoryId));
    });
  });

  describe('PUT /supplies/items/{id}', () => {
    it('updates an item', async () => {
      const res = await fetch(`${itemsUrl}/${createdItemId}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ reorderLevel: 12, location: 'Store Room A' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.reorderLevel).toBe(12);
      expect(data.location).toBe('Store Room A');
    });
  });

  describe('POST /supplies/items/{id}/merge', () => {
    it('merges a duplicate into a target, moving stock and soft-deleting the source', async () => {
      const target = await createItem({ categoryId, name: uniqueName('Merge Target'), unit: 'piece' });
      const source = await createItem({ categoryId, name: uniqueName('Merge Source'), unit: 'piece' });

      const res = await fetch(`${itemsUrl}/${source.uuid}/merge`, {
        method: 'POST', headers,
        body: JSON.stringify({ targetItemId: target.uuid }),
      });
      expect(res.status).toBe(200);
      const merged = await res.json();
      expect(merged.uuid).toBe(target.uuid);

      // Source is gone.
      const gone = await fetch(`${itemsUrl}/${source.uuid}`, { headers });
      expect(gone.status).toBe(404);
    });
  });

  describe('DELETE /supplies/items/{id}', () => {
    it('soft-deletes an item', async () => {
      const res = await fetch(`${itemsUrl}/${createdItemId}`, { method: 'DELETE', headers });
      expect(res.status).toBe(200);
      const after = await fetch(`${itemsUrl}/${createdItemId}`, { headers });
      expect(after.status).toBe(404);
    });
  });
});
