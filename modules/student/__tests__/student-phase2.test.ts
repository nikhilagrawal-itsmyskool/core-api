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

// Phase 2: demographics, addresses, siblings, lookups, photo variants.
describe('Student phase-2 API', () => {
  let pool: any;
  let f: Fixtures;

  beforeAll(async () => {
    pool = createTestPool();
    f = await createFixtures(pool);
  });

  afterAll(async () => {
    // Clean phase-2 child rows for students created this run, then fixtures.
    await pool.query(
      `delete from student_address where student_id in (select uuid from student where school_id = $1 and admission_number like $2)`,
      [f.schoolId, `${f.tag}%`]
    );
    await pool.query(
      `delete from student_sibling where student_id in (select uuid from student where school_id = $1 and admission_number like $2)`,
      [f.schoolId, `${f.tag}%`]
    );
    await pool.query(`delete from student_lookup where school_id = $1 and label like $2`, [f.schoolId, `${f.tag}%`]);
    await cleanupFixtures(pool, f);
    await pool.end();
  });

  it('stores extended demographics + inline address and returns them in detail', async () => {
    const created = await createStudent({
      name: `${f.tag} Demo`,
      admissionNumber: `${f.tag}-DEMO`,
      studentEmail: 'demo@example.com',
      studentMobile: '9990000001',
      categoryCode: 'obc',
      bloodGroupCode: 'o+',
      aadhaarNumber: '123412341234',
      previousSchool: 'Old Public School',
      admissionDate: '2025-04-10',
      addresses: [
        { isPermanent: true, isCommunication: true, line: 'Kutra Colony', cityCode: `${f.tag} Fatehgarh`, stateCode: 'uttar-pradesh', pincode: '209601' },
      ],
    });
    expect(created.categoryCode).toBe('obc');
    expect(created.bloodGroupCode).toBe('o+');
    expect(created.aadhaarNumber).toBe('123412341234');
    expect(created.addresses.length).toBe(1);
    expect(created.addresses[0].isCommunication).toBe(true);
    // city auto-created as a lookup and stored as a code
    expect(created.addresses[0].cityCode).toBeTruthy();
    expect(created.addresses[0].stateCode).toBe('uttar-pradesh');
  });

  it('enforces a single communication address (demotes prior on set)', async () => {
    const s = await createStudent({ name: `${f.tag} Addr`, admissionNumber: `${f.tag}-ADDR` });
    const url = `${BASE_URL}/${s.uuid}/addresses`;

    const a1 = await (await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ isPermanent: true, isCommunication: true, line: 'Permanent line' }),
    })).json();
    expect(a1.isCommunication).toBe(true);

    const a2 = await (await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ isCommunication: true, line: 'Correspondence line' }),
    })).json();
    expect(a2.isCommunication).toBe(true);

    const list = await (await fetch(url, { headers })).json();
    const commRows = list.addresses.filter((a: any) => a.isCommunication === true);
    expect(commRows.length).toBe(1);
    expect(commRows[0].uuid).toBe(a2.uuid);
  });

  it('links, lists and unlinks siblings', async () => {
    const a = await createStudent({ name: `${f.tag} SibA`, admissionNumber: `${f.tag}-SIBA` });
    const b = await createStudent({ name: `${f.tag} SibB`, admissionNumber: `${f.tag}-SIBB` });

    const linked = await (await fetch(`${BASE_URL}/${a.uuid}/siblings`, {
      method: 'POST', headers, body: JSON.stringify({ siblingStudentId: b.uuid }),
    })).json();
    expect(linked.siblings.length).toBe(1);
    expect(linked.siblings[0].siblingStudentId).toBe(b.uuid);

    // bidirectional: B sees A
    const bSide = await (await fetch(`${BASE_URL}/${b.uuid}/siblings`, { headers })).json();
    expect(bSide.siblings.some((x: any) => x.siblingStudentId === a.uuid)).toBe(true);

    const del = await fetch(`${BASE_URL}/${a.uuid}/siblings/${b.uuid}`, { method: 'DELETE', headers });
    expect(del.status).toBe(200);
    const after = await (await fetch(`${BASE_URL}/${a.uuid}/siblings`, { headers })).json();
    expect(after.siblings.length).toBe(0);
  });

  it('seeds lookups and supports create', async () => {
    const seeded = await (await fetch(`${BASE_URL}/lookups?type=blood_group`, { headers })).json();
    expect(seeded.lookups.some((l: any) => l.code === 'o+')).toBe(true);

    const created = await (await fetch(`${BASE_URL}/lookups`, {
      method: 'POST', headers,
      body: JSON.stringify({ lookupType: 'mother_tongue', code: `${f.tag}-lang`, label: `${f.tag} Lang` }),
    })).json();
    expect(created.lookupType).toBe('mother_tongue');
  });

  it('stores guardian with relationship/designation/organisation/education', async () => {
    const s = await createStudent({ name: `${f.tag} GExt`, admissionNumber: `${f.tag}-GEXT` });
    const g = await (await fetch(`${BASE_URL}/${s.uuid}/guardians`, {
      method: 'POST', headers,
      body: JSON.stringify({
        relation: 'guardian', relationship: 'uncle', name: `${f.tag} Uncle`,
        occupation: 'Business', designation: 'Manager', organisation: 'Acme', education: 'M.A.',
      }),
    })).json();
    expect(g.relationship).toBe('uncle');
    expect(g.designation).toBe('Manager');
    expect(g.organisation).toBe('Acme');
    expect(g.education).toBe('M.A.');
  });

  it('stores original + thumb photos and returns both ids in detail', async () => {
    const s = await createStudent({ name: `${f.tag} Pix`, admissionNumber: `${f.tag}-PIX` });
    const url = `${BASE_URL}/photos/student/${s.uuid}`;

    const orig = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ fileName: 'p.png', mimeType: 'image/png', base64Data: TINY_PNG }),
    });
    expect(orig.status).toBe(200);
    const thumb = await fetch(`${url}?variant=thumb`, {
      method: 'POST', headers,
      body: JSON.stringify({ fileName: 't.png', mimeType: 'image/png', base64Data: TINY_PNG }),
    });
    expect(thumb.status).toBe(200);

    const detail = await (await fetch(`${BASE_URL}/${s.uuid}`, { headers })).json();
    expect(detail.photoId).toBeTruthy();
    expect(detail.photoThumbId).toBeTruthy();
    expect(detail.photoId).not.toBe(detail.photoThumbId);
  });
});
