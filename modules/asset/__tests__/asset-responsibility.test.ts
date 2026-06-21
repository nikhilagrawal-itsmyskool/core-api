import { BASE_URL, headers, typeIdByCode, createAsset } from './helpers';

describe('Asset Responsibility API', () => {
  const assetsUrl = `${BASE_URL}/assets`;
  let buildingTypeId: string;
  let roomTypeId: string;
  let fanTypeId: string;

  // employee ids must fit varchar(12)
  const empSharma = 'empsharma001';
  const empRoy = 'emproy000001';
  const empIyer = 'empiyer00001';

  beforeAll(async () => {
    buildingTypeId = await typeIdByCode('building');
    roomTypeId = await typeIdByCode('room');
    fanTypeId = await typeIdByCode('fan');
  });

  async function getResponsibility(id: string) {
    const res = await fetch(`${assetsUrl}/${id}/responsibility`, { headers });
    return res.json();
  }

  async function setResponsibility(id: string, responsibleId: string | null) {
    return fetch(`${assetsUrl}/${id}/responsibility`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ responsibleId }),
    });
  }

  it('inherits responsibility from the nearest ancestor', async () => {
    const room = await createAsset({ typeId: roomTypeId, name: 'Resp Room', responsibleId: empSharma });
    const fan = await createAsset({ typeId: fanTypeId, name: 'Resp Fan', parentId: room.uuid });

    const resp = await getResponsibility(fan.uuid);
    expect(resp.effectiveResponsibleId).toBe(empSharma);
    expect(resp.responsibilitySource).toBe('inherited');
    expect(resp.isDelegated).toBe(false);
  });

  it('flags a different leaf owner as a delegation', async () => {
    const room = await createAsset({ typeId: roomTypeId, name: 'Deleg Room', responsibleId: empSharma });
    const fan = await createAsset({ typeId: fanTypeId, name: 'Deleg Fan', parentId: room.uuid });

    const setRes = await setResponsibility(fan.uuid, empRoy);
    expect(setRes.status).toBe(200);

    const resp = await getResponsibility(fan.uuid);
    expect(resp.effectiveResponsibleId).toBe(empRoy);
    expect(resp.responsibilitySource).toBe('self');
    expect(resp.isDelegated).toBe(true);
  });

  it('re-resolves an inherited owner after a move, but keeps an explicit one', async () => {
    const room1 = await createAsset({ typeId: roomTypeId, name: 'Follow Room 1', responsibleId: empSharma });
    const room2 = await createAsset({ typeId: roomTypeId, name: 'Follow Room 2', responsibleId: empIyer });

    // Inherited fan follows the new location.
    const inheritedFan = await createAsset({ typeId: fanTypeId, name: 'Follow Fan A', parentId: room1.uuid });
    await fetch(`${assetsUrl}/${inheritedFan.uuid}/move`, {
      method: 'POST', headers, body: JSON.stringify({ toParentId: room2.uuid }),
    });
    const inheritedResp = await getResponsibility(inheritedFan.uuid);
    expect(inheritedResp.effectiveResponsibleId).toBe(empIyer);
    expect(inheritedResp.responsibilitySource).toBe('inherited');

    // Explicitly-owned fan keeps its owner across the move.
    const explicitFan = await createAsset({ typeId: fanTypeId, name: 'Follow Fan B', parentId: room1.uuid, responsibleId: empRoy });
    await fetch(`${assetsUrl}/${explicitFan.uuid}/move`, {
      method: 'POST', headers, body: JSON.stringify({ toParentId: room2.uuid }),
    });
    const explicitResp = await getResponsibility(explicitFan.uuid);
    expect(explicitResp.effectiveResponsibleId).toBe(empRoy);
    expect(explicitResp.responsibilitySource).toBe('self');
  });

  it('lists assets a person is effectively responsible for', async () => {
    const room = await createAsset({ typeId: roomTypeId, name: 'ByResp Room', responsibleId: empSharma });
    const fan = await createAsset({ typeId: fanTypeId, name: 'ByResp Fan', parentId: room.uuid });

    const res = await fetch(`${assetsUrl}/responsible/${empSharma}`, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = data.map((a: any) => a.uuid);
    expect(ids).toContain(room.uuid); // direct
    expect(ids).toContain(fan.uuid); // inherited
  });
});
