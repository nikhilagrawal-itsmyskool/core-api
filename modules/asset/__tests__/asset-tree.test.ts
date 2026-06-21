import { BASE_URL, headers, typeIdByCode, createAsset } from './helpers';

describe('Asset Tree API', () => {
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

  it('returns a nested subtree with quantities', async () => {
    const building = await createAsset({ typeId: buildingTypeId, name: 'Block A' });
    const room = await createAsset({ typeId: roomTypeId, name: 'Room T1', parentId: building.uuid });
    await createAsset({ typeId: fanTypeId, name: 'Fan T1', parentId: room.uuid });
    await createAsset({ typeId: benchTypeId, name: 'Student Benches', parentId: room.uuid, quantity: 40 });

    const res = await fetch(`${BASE_URL}/assets/tree?rootId=${building.uuid}`, { headers });
    expect(res.status).toBe(200);
    const tree = await res.json();
    expect(Array.isArray(tree)).toBe(true);
    expect(tree.length).toBe(1);

    const root = tree[0];
    expect(root.uuid).toBe(building.uuid);
    expect(root.children.length).toBe(1);

    const roomNode = root.children[0];
    expect(roomNode.uuid).toBe(room.uuid);
    expect(roomNode.children.length).toBe(2);

    const benches = roomNode.children.find((c: any) => c.name === 'Student Benches');
    expect(benches.quantity).toBe(40);
    expect(benches.typeCode).toBe('bench');
  });
});
