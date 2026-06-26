import { BASE_URL, headers, uniqueCode, closePool } from './helpers';

afterAll(async () => { await closePool(); });

describe('Timetable API — subjects', () => {
  it('creates, fetches, updates and deletes a subject', async () => {
    const code = uniqueCode('SUB');
    // create
    let res = await fetch(`${BASE_URL}/subjects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'Physics', code, kind: 'academic' }),
    });
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created.uuid).toBeDefined();
    expect(created.kind).toBe('academic');

    // get
    res = await fetch(`${BASE_URL}/subjects/${created.uuid}`, { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBe(code);

    // list includes it
    res = await fetch(`${BASE_URL}/subjects`, { headers });
    const list = await res.json();
    expect(list.subjects.some((s: any) => s.uuid === created.uuid)).toBe(true);

    // update
    res = await fetch(`${BASE_URL}/subjects/${created.uuid}`, {
      method: 'PUT', headers, body: JSON.stringify({ name: 'Physics II', kind: 'games' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('Physics II');

    // delete
    res = await fetch(`${BASE_URL}/subjects/${created.uuid}`, { method: 'DELETE', headers });
    expect(res.status).toBe(200);

    // gone
    res = await fetch(`${BASE_URL}/subjects/${created.uuid}`, { headers });
    expect(res.status).toBe(404);
  });

  it('rejects duplicate subject code', async () => {
    const code = uniqueCode('DUP');
    let res = await fetch(`${BASE_URL}/subjects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'A', code, kind: 'academic' }),
    });
    expect(res.status).toBe(200);
    res = await fetch(`${BASE_URL}/subjects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'B', code, kind: 'academic' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid kind', async () => {
    const res = await fetch(`${BASE_URL}/subjects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'X', code: uniqueCode('BAD'), kind: 'sports' }),
    });
    expect(res.status).toBe(400);
  });

  it('requires the school code header', async () => {
    const res = await fetch(`${BASE_URL}/subjects`, { headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(400);
  });
});
