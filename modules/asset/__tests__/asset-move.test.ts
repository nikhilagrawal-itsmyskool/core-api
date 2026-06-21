import { BASE_URL, headers, typeIdByCode, createAsset } from './helpers';

describe('Asset Move / Split API', () => {
  const assetsUrl = `${BASE_URL}/assets`;
  let buildingTypeId: string;
  let roomTypeId: string;
  let fanTypeId: string;
  let benchTypeId: string;

  beforeAll(async () => {
    buildingTypeId = await typeIdByCode('building');
    roomTypeId = await typeIdByCode('room');
    fanTypeId = await typeIdByCode('fan');
    benchTypeId = await typeIdByCode('bench');
  });

  it('moves a whole node and logs the movement', async () => {
    const building = await createAsset({ typeId: buildingTypeId, name: 'Move Block' });
    const room1 = await createAsset({ typeId: roomTypeId, name: 'Move Room 1', parentId: building.uuid });
    const room2 = await createAsset({ typeId: roomTypeId, name: 'Move Room 2', parentId: building.uuid });
    const fan = await createAsset({ typeId: fanTypeId, name: 'Move Fan', parentId: room1.uuid });

    const moveRes = await fetch(`${assetsUrl}/${fan.uuid}/move`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ toParentId: room2.uuid, reason: 'Reorganised' }),
    });
    expect(moveRes.status).toBe(200);
    const moved = await moveRes.json();
    expect(moved.moved.parentId).toBe(room2.uuid);

    const movementsRes = await fetch(`${assetsUrl}/${fan.uuid}/movements`, { headers });
    const movements = await movementsRes.json();
    expect(movements.length).toBeGreaterThanOrEqual(1);
    expect(movements[0].toParentId).toBe(room2.uuid);
    expect(movements[0].fromParentId).toBe(room1.uuid);
  });

  it('re-tags a moved coded item and records the old and new tag', async () => {
    const building = await createAsset({ typeId: buildingTypeId, name: 'Retag Block' });
    const room1 = await createAsset({ typeId: roomTypeId, name: 'Retag Room 1', parentId: building.uuid });
    const room2 = await createAsset({ typeId: roomTypeId, name: 'Retag Room 2', parentId: building.uuid });
    const fan = await createAsset({ typeId: fanTypeId, name: 'Retag Fan', parentId: room1.uuid });

    // A single item is auto-tagged on creation with a hierarchy path.
    expect(fan.assetCode).toBeTruthy();
    expect(fan.assetCode).toContain('fn-');

    const moveRes = await fetch(`${assetsUrl}/${fan.uuid}/move`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ toParentId: room2.uuid }),
    });
    expect(moveRes.status).toBe(200);
    const moved = (await moveRes.json()).moved;
    expect(moved.assetCode).toBeTruthy();
    expect(moved.assetCode).not.toBe(fan.assetCode); // re-tagged to reflect new room

    const movements = await (await fetch(`${assetsUrl}/${fan.uuid}/movements`, { headers })).json();
    expect(movements[0].fromCode).toBe(fan.assetCode);
    expect(movements[0].toCode).toBe(moved.assetCode);
  });

  it('splits a quantity bucket across rooms', async () => {
    const building = await createAsset({ typeId: buildingTypeId, name: 'Split Block' });
    const room1 = await createAsset({ typeId: roomTypeId, name: 'Split Room 1', parentId: building.uuid });
    const room2 = await createAsset({ typeId: roomTypeId, name: 'Split Room 2', parentId: building.uuid });
    const benches = await createAsset({ typeId: benchTypeId, name: 'Split Benches', parentId: room1.uuid, quantity: 40 });

    const splitRes = await fetch(`${assetsUrl}/${benches.uuid}/move`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ toParentId: room2.uuid, quantity: 10 }),
    });
    expect(splitRes.status).toBe(200);
    const result = await splitRes.json();
    expect(result.source.quantity).toBe(30);
    expect(result.moved.quantity).toBe(10);
    expect(result.moved.parentId).toBe(room2.uuid);
  });

  it('rejects moving an asset under its own descendant', async () => {
    const building = await createAsset({ typeId: buildingTypeId, name: 'Cycle Block' });
    const room = await createAsset({ typeId: roomTypeId, name: 'Cycle Room', parentId: building.uuid });

    const res = await fetch(`${assetsUrl}/${building.uuid}/move`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ toParentId: room.uuid }),
    });
    expect(res.status).toBe(400);
  });
});
