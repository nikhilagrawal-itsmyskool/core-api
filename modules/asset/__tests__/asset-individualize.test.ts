import { BASE_URL, headers, typeIdByCode, createAsset } from './helpers';

describe('Asset Individualize API', () => {
  const assetsUrl = `${BASE_URL}/assets`;
  let roomTypeId: string;
  let benchTypeId: string;

  beforeAll(async () => {
    roomTypeId = await typeIdByCode('room');
    benchTypeId = await typeIdByCode('bench');
  });

  it('tags some of a bucket into coded items and decrements the bucket', async () => {
    const room = await createAsset({ typeId: roomTypeId, name: 'Tag Room' });
    const benches = await createAsset({ typeId: benchTypeId, name: 'Tag Benches', parentId: room.uuid, quantity: 40 });

    const res = await fetch(`${assetsUrl}/${benches.uuid}/individualize`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ count: 5 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(5);
    expect(data.items.length).toBe(5);
    data.items.forEach((it: any) => {
      expect(it.assetCode).toBeTruthy();
      expect(it.assetCode).toContain('bn-'); // bench abbreviation in the path tag
      expect(it.quantity).toBe(1);
      expect(it.parentId).toBe(room.uuid);
    });

    // Bucket decremented to 35.
    const bucketRes = await fetch(`${assetsUrl}/${benches.uuid}`, { headers });
    expect((await bucketRes.json()).quantity).toBe(35);
  });

  it('accepts user-supplied codes and rejects duplicates', async () => {
    const room = await createAsset({ typeId: roomTypeId, name: 'Code Room' });
    const benches = await createAsset({ typeId: benchTypeId, name: 'Code Benches', parentId: room.uuid, quantity: 5 });

    const unique = `CUSTOM-${Date.now()}`;
    const okRes = await fetch(`${assetsUrl}/${benches.uuid}/individualize`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ count: 1, codes: [unique] }),
    });
    expect(okRes.status).toBe(200);
    expect((await okRes.json()).items[0].assetCode).toBe(unique);

    // Same code again -> conflict.
    const dupRes = await fetch(`${assetsUrl}/${benches.uuid}/individualize`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ count: 1, codes: [unique] }),
    });
    expect(dupRes.status).toBe(400);
  });

  it('suggests the next asset code', async () => {
    const res = await fetch(`${assetsUrl}/code/suggest?prefix=AST`, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.code).toBe('string');
    expect(data.code.startsWith('AST-')).toBe(true);
  });

  it('suggests a hierarchy path tag for a type under a parent', async () => {
    const room = await createAsset({ typeId: roomTypeId, name: 'Suggest Room' });
    const res = await fetch(`${assetsUrl}/code/suggest?typeId=${benchTypeId}&parentId=${room.uuid}`, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.code).toContain('rm-'); // parent room level
    expect(data.code).toContain('bn-'); // bench level
  });
});
