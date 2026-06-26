import {
  BASE_URL, headers, getClassId, createSubject, TEST_ACADEMIC_YEAR_ID, closePool,
} from './helpers';

afterAll(async () => { await closePool(); });

describe('Timetable API — class subjects', () => {
  it('creates a class subject with valid block rules and lists it', async () => {
    const classId = await getClassId();
    const subject = await createSubject();
    const res = await fetch(`${BASE_URL}/class-subjects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        academicYearId: TEST_ACADEMIC_YEAR_ID,
        classId,
        subjectId: subject.uuid,
        periodsPerWeek: 10,
        blockRules: { blocks: [{ size: 2, count: 2 }, { size: 1, count: 6 }], maxPerDay: 2 },
      }),
    });
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created.periodsPerWeek).toBe(10);
    expect(created.subjectName).toBeDefined();

    const listRes = await fetch(`${BASE_URL}/class-subjects?classId=${classId}`, { headers });
    const list = await listRes.json();
    expect(list.classSubjects.some((cs: any) => cs.uuid === created.uuid)).toBe(true);

    // cleanup
    await fetch(`${BASE_URL}/class-subjects/${created.uuid}`, { method: 'DELETE', headers });
  });

  it('rejects block rules whose sum != periodsPerWeek', async () => {
    const classId = await getClassId();
    const subject = await createSubject();
    const res = await fetch(`${BASE_URL}/class-subjects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        academicYearId: TEST_ACADEMIC_YEAR_ID,
        classId,
        subjectId: subject.uuid,
        periodsPerWeek: 10,
        blockRules: { blocks: [{ size: 2, count: 2 }] }, // sums to 4, not 10
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid classId', async () => {
    const subject = await createSubject();
    const res = await fetch(`${BASE_URL}/class-subjects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        academicYearId: TEST_ACADEMIC_YEAR_ID,
        classId: 'does-not-exist',
        subjectId: subject.uuid,
        periodsPerWeek: 5,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate class+subject for the same year', async () => {
    const classId = await getClassId();
    const subject = await createSubject();
    const body = {
      academicYearId: TEST_ACADEMIC_YEAR_ID, classId, subjectId: subject.uuid, periodsPerWeek: 5,
    };
    let res = await fetch(`${BASE_URL}/class-subjects`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    const created = await res.json();
    res = await fetch(`${BASE_URL}/class-subjects`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(res.status).toBe(400);
    await fetch(`${BASE_URL}/class-subjects/${created.uuid}`, { method: 'DELETE', headers });
  });
});
