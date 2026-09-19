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

  it('rejects an empty class selection', async () => {
    const { status } = await roster({ academicYearId: f.yearFromId, classIds: [], fields: ['studentName'] });
    expect(status).toBe(400);
  });

  it('rejects an empty field selection', async () => {
    const { status } = await roster({ academicYearId: f.yearFromId, classIds: [f.classAId], fields: [] });
    expect(status).toBe(400);
  });
});
