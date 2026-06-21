import { BASE_URL, headers, typeIdByCode, createAsset } from './helpers';

describe('Asset Summary API', () => {
  it('returns per-type quantity totals', async () => {
    const roomTypeId = await typeIdByCode('room');
    const benchTypeId = await typeIdByCode('bench');

    const room = await createAsset({ typeId: roomTypeId, name: 'Summary Room' });
    await createAsset({ typeId: benchTypeId, name: 'Summary Benches', parentId: room.uuid, quantity: 7 });

    const res = await fetch(`${BASE_URL}/assets/summary`, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);

    const bench = data.find((d: any) => d.typeCode === 'bench');
    expect(bench).toBeDefined();
    expect(bench.totalQuantity).toBeGreaterThanOrEqual(7);
    expect(bench.bucketCount).toBeGreaterThanOrEqual(1);
  });

  it('drills down into one type with ancestor breadcrumbs', async () => {
    const buildingTypeId = await typeIdByCode('building');
    const roomTypeId = await typeIdByCode('room');
    const fanTypeId = await typeIdByCode('fan');

    const building = await createAsset({ typeId: buildingTypeId, name: 'Counts Block' });
    const room = await createAsset({ typeId: roomTypeId, name: 'Counts Room', parentId: building.uuid });
    await createAsset({ typeId: fanTypeId, name: 'Counts Fan', parentId: room.uuid });

    const res = await fetch(`${BASE_URL}/assets/counts?typeId=${fanTypeId}`, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBeGreaterThanOrEqual(1);

    const row = data.rows.find((r: any) => r.name === 'Counts Fan');
    expect(row).toBeDefined();
    // Ancestors are ordered immediate-parent -> root.
    expect(row.ancestors[0].name).toBe('Counts Room');
    expect(row.ancestors.map((a: any) => a.name)).toContain('Counts Block');
  });

  it('requires a typeId', async () => {
    const res = await fetch(`${BASE_URL}/assets/counts`, { headers });
    expect(res.status).toBe(400);
  });
});
