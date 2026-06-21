import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

const headers = {
  'Content-Type': 'application/json',
  'X-School-Code': TEST_SCHOOL_CODE,
};

describe('Asset Type API', () => {
  const typesUrl = `${BASE_URL}/asset-types`;
  const assetsUrl = `${BASE_URL}/assets`;

  it('seeds default types on first use and lists them', async () => {
    const res = await fetch(typesUrl, { method: 'GET', headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    const codes = data.map((t: any) => t.code);
    expect(codes).toContain('room');
    expect(codes).toContain('fan');
    // container vs item kind is carried
    const room = data.find((t: any) => t.code === 'room');
    expect(room.kind).toBe('container');
  });

  it('seeds tag abbreviations and institution/campus types', async () => {
    const data = await (await fetch(typesUrl, { headers })).json();
    const codes = data.map((t: any) => t.code);
    expect(codes).toEqual(expect.arrayContaining(['institution', 'campus']));
    const fan = data.find((t: any) => t.code === 'fan');
    expect(fan.tagAbbr).toBe('fn');
  });

  it('creates a type with a custom abbreviation and tag-exclusion flag', async () => {
    const code = `ab${Date.now()}`;
    const res = await fetch(typesUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code, label: 'Abbr Type', kind: 'container', tagAbbr: 'xz', includeInTag: false }),
    });
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created.tagAbbr).toBe('xz');
    expect(created.includeInTag).toBe(false);
  });

  it('creates, updates and deletes a custom type', async () => {
    const code = `tt${Date.now()}`;
    const createRes = await fetch(typesUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code, label: 'Test Type', kind: 'item' }),
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.code).toBe(code);
    expect(created.kind).toBe('item');

    const updateRes = await fetch(`${typesUrl}/${created.uuid}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ label: 'Renamed Type' }),
    });
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).label).toBe('Renamed Type');

    const delRes = await fetch(`${typesUrl}/${created.uuid}`, { method: 'DELETE', headers });
    expect(delRes.status).toBe(200);
  });

  it('rejects duplicate type codes', async () => {
    const code = `dup${Date.now()}`;
    await fetch(typesUrl, { method: 'POST', headers, body: JSON.stringify({ code, label: 'A', kind: 'item' }) });
    const dupRes = await fetch(typesUrl, { method: 'POST', headers, body: JSON.stringify({ code, label: 'B', kind: 'item' }) });
    expect(dupRes.status).toBe(400);
  });

  it('blocks deleting a type that assets still use', async () => {
    const code = `inuse${Date.now()}`;
    const typeRes = await fetch(typesUrl, { method: 'POST', headers, body: JSON.stringify({ code, label: 'In Use', kind: 'container' }) });
    const type = await typeRes.json();

    const assetRes = await fetch(assetsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ typeId: type.uuid, name: 'Uses Type' }),
    });
    expect(assetRes.status).toBe(200);

    const delRes = await fetch(`${typesUrl}/${type.uuid}`, { method: 'DELETE', headers });
    expect(delRes.status).toBe(400);
  });
});
