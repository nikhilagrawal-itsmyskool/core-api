import {
  BASE_URL,
  headers,
  createTestPool,
  createFixtures,
  cleanupFixtures,
  createStudent,
  enrollmentRows,
  studentStatus,
  uid,
  Fixtures,
} from './helpers';

async function post(path: string, body: any) {
  const res = await fetch(`${BASE_URL}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe('Student promotion lifecycle', () => {
  let pool: any;
  let f: Fixtures;
  const extraClassIds: string[] = [];

  async function makeClass(label: string): Promise<string> {
    const id = `cl${uid()}`.slice(0, 12);
    await pool.query(
      `insert into class (uuid, name, code, school_id, createdby_userid, created_at) values ($1,$2,$3,$4,'test',$5)`,
      [id, `${f.tag}-${label}`, `${f.tag}${label}`, f.schoolId, new Date()]
    );
    extraClassIds.push(id);
    return id;
  }

  beforeAll(async () => {
    pool = createTestPool();
    f = await createFixtures(pool);
  });

  afterAll(async () => {
    await pool.query(`delete from student_class where class_id = any($1)`, [extraClassIds]);
    await pool.query(`delete from class where uuid = any($1)`, [extraClassIds]);
    await cleanupFixtures(pool, f);
    await pool.end();
  });

  it('promotes a single student into the new year+class (idempotent)', async () => {
    const s = await createStudent({
      name: `${f.tag} P1`,
      admissionNumber: `${f.tag}-P1`,
      academicYearId: f.yearFromId,
      classId: f.classAId,
    });

    const first = await post('promote', {
      academicYearFromId: f.yearFromId,
      academicYearToId: f.yearToId,
      items: [{ studentId: s.uuid, toClassId: f.classBId, rollNumber: 5 }],
    });
    expect(first.status).toBe(200);
    expect(first.body.done).toBe(1);

    const rows = await enrollmentRows(pool, s.uuid);
    expect(rows.some((r) => r.academic_year_id === f.yearToId && r.class_id === f.classBId && r.roll_number === 5)).toBe(true);

    // Re-run is idempotent → skipped, not duplicated.
    const again = await post('promote', {
      academicYearFromId: f.yearFromId,
      academicYearToId: f.yearToId,
      items: [{ studentId: s.uuid, toClassId: f.classBId }],
    });
    expect(again.body.done).toBe(0);
    expect(again.body.skipped).toBe(1);
    const rows2 = await enrollmentRows(pool, s.uuid);
    expect(rows2.filter((r) => r.academic_year_id === f.yearToId && r.class_id === f.classBId).length).toBe(1);
  });

  it('retains a held-back student in the same class for the new year', async () => {
    const s = await createStudent({
      name: `${f.tag} R1`,
      admissionNumber: `${f.tag}-R1`,
      academicYearId: f.yearFromId,
      classId: f.classAId,
    });

    const res = await post('promote', {
      academicYearFromId: f.yearFromId,
      academicYearToId: f.yearToId,
      items: [{ studentId: s.uuid, toClassId: f.classAId }], // same class
    });
    expect(res.body.done).toBe(1);
    const rows = await enrollmentRows(pool, s.uuid);
    expect(rows.some((r) => r.academic_year_id === f.yearToId && r.class_id === f.classAId)).toBe(true);
  });

  it('graduates students (status inactive, no new enrollment; idempotent)', async () => {
    const s = await createStudent({
      name: `${f.tag} G1`,
      admissionNumber: `${f.tag}-G1`,
      academicYearId: f.yearFromId,
      classId: f.classAId,
    });

    const res = await post('graduate', { academicYearFromId: f.yearFromId, studentIds: [s.uuid] });
    expect(res.body.done).toBe(1);
    expect(await studentStatus(pool, s.uuid)).toBe('inactive');

    const rows = await enrollmentRows(pool, s.uuid);
    expect(rows.some((r) => r.academic_year_id === f.yearToId)).toBe(false);

    const again = await post('graduate', { academicYearFromId: f.yearFromId, studentIds: [s.uuid] });
    expect(again.body.skipped).toBe(1);
  });

  it('promotes a whole class, honouring the exclude list', async () => {
    const src = await makeClass('SRC');
    const tgt = await makeClass('TGT');

    const a = await createStudent({ name: `${f.tag} C-A`, admissionNumber: `${f.tag}-CA`, academicYearId: f.yearFromId, classId: src });
    const b = await createStudent({ name: `${f.tag} C-B`, admissionNumber: `${f.tag}-CB`, academicYearId: f.yearFromId, classId: src });
    const held = await createStudent({ name: `${f.tag} C-H`, admissionNumber: `${f.tag}-CH`, academicYearId: f.yearFromId, classId: src });

    const res = await post('promote-class', {
      fromClassId: src,
      academicYearFromId: f.yearFromId,
      toClassId: tgt,
      academicYearToId: f.yearToId,
      excludeStudentIds: [held.uuid],
    });
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(2);

    expect((await enrollmentRows(pool, a.uuid)).some((r) => r.class_id === tgt && r.academic_year_id === f.yearToId)).toBe(true);
    expect((await enrollmentRows(pool, b.uuid)).some((r) => r.class_id === tgt && r.academic_year_id === f.yearToId)).toBe(true);
    expect((await enrollmentRows(pool, held.uuid)).some((r) => r.academic_year_id === f.yearToId)).toBe(false);
  });

  it('enforces roll-number uniqueness within a class+year', async () => {
    const cls = await makeClass('ROLL');
    const s1 = await createStudent({ name: `${f.tag} RN1`, admissionNumber: `${f.tag}-RN1`, academicYearId: f.yearFromId, classId: f.classAId });
    const s2 = await createStudent({ name: `${f.tag} RN2`, admissionNumber: `${f.tag}-RN2`, academicYearId: f.yearFromId, classId: f.classAId });

    const ok = await post('promote', {
      academicYearFromId: f.yearFromId,
      academicYearToId: f.yearToId,
      items: [{ studentId: s1.uuid, toClassId: cls, rollNumber: 7 }],
    });
    expect(ok.body.done).toBe(1);

    // Same roll number in the same class+year must be rejected (DB partial unique index).
    const clash = await post('promote', {
      academicYearFromId: f.yearFromId,
      academicYearToId: f.yearToId,
      items: [{ studentId: s2.uuid, toClassId: cls, rollNumber: 7 }],
    });
    expect(clash.status).toBeGreaterThanOrEqual(400);
  });
});
