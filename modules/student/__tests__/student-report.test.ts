import {
  BASE_URL,
  headers,
  createTestPool,
  createFixtures,
  cleanupFixtures,
  createStudent,
  Fixtures,
} from './helpers';

async function roster(body: Record<string, any>) {
  const res = await fetch(`${BASE_URL}/reports/roster`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() };
}

describe('Student report API', () => {
  let pool: any;
  let f: Fixtures;

  beforeAll(async () => {
    pool = createTestPool();
    f = await createFixtures(pool);

    // A-class: a plain student and an RTE student; B-class: an exam-only student.
    await createStudent({
      name: `${f.tag} Aarav`,
      admissionNumber: `${f.tag}-R01`,
      gender: 'M',
      academicYearId: f.yearFromId,
      classId: f.classAId,
      rollNumber: 2,
      guardians: [{ relation: 'father', name: `${f.tag} Rajesh`, mobile: '9810000001', isPrimaryContact: true }],
    });
    await createStudent({
      name: `${f.tag} Bela`,
      admissionNumber: `${f.tag}-R02`,
      gender: 'F',
      academicYearId: f.yearFromId,
      classId: f.classAId,
      rollNumber: 1,
      rte: true,
      guardians: [{ relation: 'mother', name: `${f.tag} Sita`, mobile: '9810000002', isPrimaryContact: true }],
    });
    await createStudent({
      name: `${f.tag} Chirag`,
      admissionNumber: `${f.tag}-R03`,
      academicYearId: f.yearFromId,
      classId: f.classBId,
      rollNumber: 1,
      examOnly: true,
    });
  });

  afterAll(async () => {
    await pool.query(`delete from student_report_saved where school_id = $1 and name like $2`, [f.schoolId, `${f.tag}%`]);
    await cleanupFixtures(pool, f);
    await pool.end();
  });

  it('returns the grouped field catalogue', async () => {
    const res = await fetch(`${BASE_URL}/reports/fields`, { headers });
    expect(res.status).toBe(200);
    const { fields } = await res.json();
    const keys = fields.map((x: any) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['studentName', 'fatherMobile', 'house', 'rte', 'examOnly']));
    const father = fields.find((x: any) => x.key === 'fatherMobile');
    expect(father.contact).toBe(true);
    expect(father.group).toBe('father');
  });

  it('builds a roster across classes with only the requested columns', async () => {
    const { status, body } = await roster({
      academicYearId: f.yearFromId,
      classIds: [f.classAId, f.classBId],
      fields: ['rollNumber', 'studentName', 'fatherMobile'],
    });
    expect(status).toBe(200);
    expect(body.meta.total).toBe(3);
    expect(body.meta.classes.length).toBe(2);
    // ordered by class name, then roll number — A/Bela(1) before A/Aarav(2)
    const first = body.rows[0];
    expect(first).toHaveProperty('studentName');
    expect(first).toHaveProperty('fatherMobile');
    expect(first).toHaveProperty('className'); // always-present grouping metadata
    // an unrequested contact column must not leak into the payload
    expect(first).not.toHaveProperty('motherMobile');
    expect(first).not.toHaveProperty('guardianWhatsapp');
  });

  it('filters to RTE students only', async () => {
    const { status, body } = await roster({
      academicYearId: f.yearFromId,
      classIds: [f.classAId, f.classBId],
      fields: ['studentName', 'rte'],
      filter: 'rte',
    });
    expect(status).toBe(200);
    expect(body.meta.total).toBe(1);
    expect(body.rows[0].studentName).toContain('Bela');
  });

  it('filters to exam-only students only', async () => {
    const { status, body } = await roster({
      academicYearId: f.yearFromId,
      classIds: [f.classAId, f.classBId],
      fields: ['studentName', 'examOnly'],
      filter: 'examOnly',
    });
    expect(status).toBe(200);
    expect(body.meta.total).toBe(1);
    expect(body.rows[0].studentName).toContain('Chirag');
  });

  it('orders within a class by roll number, ascending then descending', async () => {
    // classA has Bela (roll 1) and Aarav (roll 2).
    const asc = await roster({
      academicYearId: f.yearFromId, classIds: [f.classAId],
      fields: ['rollNumber', 'studentName'], sort: { field: 'rollNumber', dir: 'asc' },
    });
    expect(asc.status).toBe(200);
    expect(asc.body.rows.map((r) => r.rollNumber)).toEqual([1, 2]);
    expect(asc.body.meta.sort).toEqual({ field: 'rollNumber', dir: 'asc' });

    const desc = await roster({
      academicYearId: f.yearFromId, classIds: [f.classAId],
      fields: ['rollNumber', 'studentName'], sort: { field: 'rollNumber', dir: 'desc' },
    });
    expect(desc.body.rows.map((r) => r.rollNumber)).toEqual([2, 1]);
  });

  it('rejects an empty class selection', async () => {
    const { status } = await roster({ academicYearId: f.yearFromId, classIds: [], fields: ['studentName'] });
    expect(status).toBe(400);
  });

  it('rejects an empty field selection', async () => {
    const { status } = await roster({ academicYearId: f.yearFromId, classIds: [f.classAId], fields: [] });
    expect(status).toBe(400);
  });

  describe('saved reports', () => {
    let savedName;
    let savedId;

    it('saves a report (columns + filter + layout, not classes)', async () => {
      savedName = `${f.tag}-Contacts`;
      const res = await fetch(`${BASE_URL}/reports/saved`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: savedName,
          config: { fields: ['studentName', 'fatherMobile'], filter: 'rte', orientation: 'landscape', pageBreak: false, classIds: ['should-be-ignored'] },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      savedId = body.uuid;
      expect(body.name).toBe(savedName);
      expect(body.config.filter).toBe('rte');
      expect(body.config.orientation).toBe('landscape');
      expect(body.config.fields).toEqual(['studentName', 'fatherMobile']);
      expect(body.config).not.toHaveProperty('classIds'); // classes are never saved
    });

    it('lists the saved report', async () => {
      const res = await fetch(`${BASE_URL}/reports/saved`, { headers });
      expect(res.status).toBe(200);
      const { saved } = await res.json();
      expect(saved.some((s) => s.uuid === savedId)).toBe(true);
    });

    it('upserts by name (re-saving updates config, no duplicate)', async () => {
      const res = await fetch(`${BASE_URL}/reports/saved`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: savedName, config: { fields: ['studentName'], filter: 'all', orientation: 'portrait', pageBreak: true } }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).uuid).toBe(savedId); // same row
      const list = await (await fetch(`${BASE_URL}/reports/saved`, { headers })).json();
      expect(list.saved.filter((s) => s.name === savedName).length).toBe(1);
      expect(list.saved.find((s) => s.uuid === savedId).config.filter).toBe('all');
    });

    it('rejects saving with no fields', async () => {
      const res = await fetch(`${BASE_URL}/reports/saved`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: `${f.tag}-Empty`, config: { fields: [] } }),
      });
      expect(res.status).toBe(400);
    });

    it('deletes the saved report', async () => {
      const res = await fetch(`${BASE_URL}/reports/saved/${savedId}`, { method: 'DELETE', headers });
      expect(res.status).toBe(200);
      const list = await (await fetch(`${BASE_URL}/reports/saved`, { headers })).json();
      expect(list.saved.some((s) => s.uuid === savedId)).toBe(false);
    });
  });
});
