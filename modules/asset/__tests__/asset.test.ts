import { BASE_URL, headers, typeIdByCode, createAsset } from './helpers';

describe('Asset CRUD API', () => {
  const assetsUrl = `${BASE_URL}/assets`;
  let roomTypeId: string;
  let fanTypeId: string;

  beforeAll(async () => {
    roomTypeId = await typeIdByCode('room');
    fanTypeId = await typeIdByCode('fan');
  });

  it('creates an asset with sensible defaults', async () => {
    const res = await fetch(assetsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ typeId: roomTypeId, name: 'Room 101' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('uuid');
    expect(data.name).toBe('Room 101');
    expect(data.quantity).toBe(1);
    expect(data.assetStatus).toBe('active');
    expect(data.status).toBe('active');
    expect(data.typeCode).toBe('room');
  });

  it('rejects an invalid typeId', async () => {
    const res = await fetch(assetsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ typeId: 'doesnotexist', name: 'Bad' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing name', async () => {
    const res = await fetch(assetsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ typeId: roomTypeId }),
    });
    expect(res.status).toBe(400);
  });

  it('gets an asset by id with effective responsibility', async () => {
    const room = await createAsset({ typeId: roomTypeId, name: 'Room 102' });
    const res = await fetch(`${assetsUrl}/${room.uuid}`, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.uuid).toBe(room.uuid);
    expect(data.responsibility).toBeDefined();
    expect(data.responsibility.responsibilitySource).toBe('none');
  });

  it('updates an asset', async () => {
    const room = await createAsset({ typeId: roomTypeId, name: 'Room 103' });
    const res = await fetch(`${assetsUrl}/${room.uuid}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: 'Room 103A', assetCondition: 'good' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe('Room 103A');
    expect(data.assetCondition).toBe('good');
  });

  it('filters assets by typeId', async () => {
    await createAsset({ typeId: roomTypeId, name: 'Room 104' });
    const res = await fetch(`${assetsUrl}?typeId=${roomTypeId}`, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.every((a: any) => a.typeId === roomTypeId)).toBe(true);
  });

  it('blocks deleting an asset that has active children', async () => {
    const room = await createAsset({ typeId: roomTypeId, name: 'Room 105' });
    const fan = await createAsset({ typeId: fanTypeId, name: 'Fan 1', parentId: room.uuid });

    const blocked = await fetch(`${assetsUrl}/${room.uuid}`, { method: 'DELETE', headers });
    expect(blocked.status).toBe(400);

    // Remove the child first, then the parent succeeds.
    const delChild = await fetch(`${assetsUrl}/${fan.uuid}`, { method: 'DELETE', headers });
    expect(delChild.status).toBe(200);
    const delParent = await fetch(`${assetsUrl}/${room.uuid}`, { method: 'DELETE', headers });
    expect(delParent.status).toBe(200);
  });
});
