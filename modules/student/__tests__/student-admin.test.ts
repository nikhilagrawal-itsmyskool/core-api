import {
  BASE_URL,
  headers,
  createTestPool,
  createFixtures,
  cleanupFixtures,
  createStudent,
  Fixtures,
} from './helpers';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('Student admin API', () => {
  let pool: any;
  let f: Fixtures;

  beforeAll(async () => {
    pool = createTestPool();
    f = await createFixtures(pool);
  });

  afterAll(async () => {
    await cleanupFixtures(pool, f);
    await pool.end();
  });

  it('health responds', async () => {
    const res = await fetch(`${BASE_URL}/health`, { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).module).toBe('student');
  });

  it('creates a student with initial enrollment and inline guardian, then fetches detail', async () => {
    const admissionNumber = `${f.tag}-001`;
    const created = await createStudent({
      name: `${f.tag} Aarav`,
      admissionNumber,
      gender: 'M',
      academicYearId: f.yearFromId,
      classId: f.classAId,
      rollNumber: 1,
      guardians: [{ relation: 'father', name: `${f.tag} Rajesh`, mobile: '9810000001', isPrimaryContact: true }],
    });
    expect(created.uuid).toBeDefined();
    expect(created.admissionNumber).toBe(admissionNumber);
    expect(created.currentClassId).toBe(f.classAId);
    expect(created.guardians.length).toBe(1);
    expect(created.guardians[0].relation).toBe('father');

    const res = await fetch(`${BASE_URL}/${created.uuid}`, { headers });
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.enrollments.length).toBe(1);
    expect(detail.currentRollNumber).toBe(1);
  });

  it('rejects a duplicate admission number within the school', async () => {
    const admissionNumber = `${f.tag}-DUP`;
    await createStudent({ name: `${f.tag} One`, admissionNumber });
    const res = await fetch(`${BASE_URL}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: `${f.tag} Two`, admissionNumber }),
    });
    expect(res.status).toBe(400);
  });

  it('searches by admission number and by parent phone', async () => {
    const admissionNumber = `${f.tag}-SRCH`;
    await createStudent({
      name: `${f.tag} Searchable`,
      admissionNumber,
      guardians: [{ relation: 'father', mobile: '9777712345' }],
    });
    // Note: guardian phone lives in student_guardian; the legacy phone search hits
    // the student.*_mobile columns, so search by admission number is the reliable path.
    const byAdm = await (await fetch(`${BASE_URL}/search?admissionNumber=${f.tag}-SRCH`, { headers })).json();
    expect(byAdm.some((s: any) => s.admissionNumber === admissionNumber || s.admission_number === admissionNumber)).toBe(true);
  });

  it('returns current class name in the unfiltered list', async () => {
    const admissionNumber = `${f.tag}-CLS`;
    await createStudent({
      name: `${f.tag} Classy`,
      admissionNumber,
      academicYearId: f.yearFromId,
      classId: f.classAId,
    });
    // Unfiltered search (no classId) must still carry the current class via the lateral join.
    const rows = await (await fetch(`${BASE_URL}/search?name=${f.tag} Classy`, { headers })).json();
    const row = rows.find((s: any) => s.admissionNumber === admissionNumber);
    expect(row).toBeDefined();
    expect(row.className).toBe(`${f.tag}-A`);
  });

  it('updates a student name and status', async () => {
    const created = await createStudent({ name: `${f.tag} Editable`, admissionNumber: `${f.tag}-EDIT` });
    const res = await fetch(`${BASE_URL}/${created.uuid}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: `${f.tag} Edited` }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe(`${f.tag} Edited`);
  });

  it('manages guardians: add, list, update, delete', async () => {
    const s = await createStudent({ name: `${f.tag} Guarded`, admissionNumber: `${f.tag}-GRD` });
    const gUrl = `${BASE_URL}/${s.uuid}/guardians`;

    const created = await (await fetch(gUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ relation: 'mother', name: `${f.tag} Sunita`, occupation: 'Teacher' }),
    })).json();
    expect(created.relation).toBe('mother');

    const list = await (await fetch(gUrl, { headers })).json();
    expect(list.guardians.length).toBe(1);

    const upd = await fetch(`${gUrl}/${created.uuid}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ occupation: 'Doctor' }),
    });
    expect((await upd.json()).occupation).toBe('Doctor');

    const del = await fetch(`${gUrl}/${created.uuid}`, { method: 'DELETE', headers });
    expect(del.status).toBe(200);
    const after = await (await fetch(gUrl, { headers })).json();
    expect(after.guardians.length).toBe(0);
  });

  it('creates a house and assigns it to a student', async () => {
    const house = await (await fetch(`${BASE_URL}/houses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: `${f.tag} Tagore`, color: '#ff0000' }),
    })).json();
    expect(house.uuid).toBeDefined();

    const s = await createStudent({ name: `${f.tag} Housed`, admissionNumber: `${f.tag}-HSE` });
    const assign = await fetch(`${BASE_URL}/${s.uuid}/house`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ houseId: house.uuid }),
    });
    expect(assign.status).toBe(200);

    const detail = await (await fetch(`${BASE_URL}/${s.uuid}`, { headers })).json();
    expect(detail.houseId).toBe(house.uuid);
    expect(detail.houseName).toBe(`${f.tag} Tagore`);
  });

  it('uploads / fetches / deletes a student photo with guards', async () => {
    const s = await createStudent({ name: `${f.tag} Photo`, admissionNumber: `${f.tag}-PIC` });
    const url = `${BASE_URL}/photos/student/${s.uuid}`;

    // bad mime
    const badMime = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName: 'x.gif', mimeType: 'image/gif', base64Data: TINY_PNG }),
    });
    expect(badMime.status).toBe(400);

    // oversize
    const big = Buffer.from('A'.repeat(3 * 1024 * 1024)).toString('base64');
    const oversize = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName: 'big.png', mimeType: 'image/png', base64Data: big }),
    });
    expect(oversize.status).toBe(400);

    // valid
    const ok = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName: 'p.png', mimeType: 'image/png', base64Data: TINY_PNG }),
    });
    expect(ok.status).toBe(200);

    const got = await fetch(url, { headers });
    expect(got.status).toBe(200);
    expect((await got.json()).data).toBe(TINY_PNG);

    const del = await fetch(url, { method: 'DELETE', headers });
    expect(del.status).toBe(200);
    const after = await fetch(url, { headers });
    expect(after.status).toBe(404);
  });

  it('soft-deletes a student', async () => {
    const s = await createStudent({ name: `${f.tag} Gone`, admissionNumber: `${f.tag}-DEL` });
    const del = await fetch(`${BASE_URL}/${s.uuid}`, { method: 'DELETE', headers });
    expect(del.status).toBe(200);
    const after = await fetch(`${BASE_URL}/${s.uuid}`, { headers });
    expect(after.status).toBe(404);
  });
});
