import {
  BASE_URL, headers, getClassId, createSubject, uniqueYearId,
  TEST_ACADEMIC_YEAR_ID, TEST_TEACHER_ID, TEST_TEACHER_ID_2, closePool,
} from './helpers';

afterAll(async () => { await closePool(); });

describe('Timetable API — teaching assignments & class teachers', () => {
  it('creates a teaching assignment with a period share', async () => {
    const classId = await getClassId();
    const subject = await createSubject();
    const res = await fetch(`${BASE_URL}/teaching-assignments`, {
      method: 'POST', headers,
      body: JSON.stringify({
        academicYearId: TEST_ACADEMIC_YEAR_ID, classId, subjectId: subject.uuid,
        teacherId: TEST_TEACHER_ID, periodShare: 3,
      }),
    });
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created.periodShare).toBe(3);
    expect(created.subjectName).toBeDefined();
    await fetch(`${BASE_URL}/teaching-assignments/${created.uuid}`, { method: 'DELETE', headers });
  });

  it('enforces one class teacher per class per year', async () => {
    const classId = await getClassId();
    const yearId = uniqueYearId();
    let res = await fetch(`${BASE_URL}/class-teachers`, {
      method: 'POST', headers,
      body: JSON.stringify({ academicYearId: yearId, classId, teacherId: TEST_TEACHER_ID }),
    });
    expect(res.status).toBe(200);
    const created = await res.json();

    res = await fetch(`${BASE_URL}/class-teachers`, {
      method: 'POST', headers,
      body: JSON.stringify({ academicYearId: yearId, classId, teacherId: TEST_TEACHER_ID_2 }),
    });
    expect(res.status).toBe(400);

    // can reassign via update
    res = await fetch(`${BASE_URL}/class-teachers/${created.uuid}`, {
      method: 'PUT', headers, body: JSON.stringify({ teacherId: TEST_TEACHER_ID_2 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).teacherId).toBe(TEST_TEACHER_ID_2);

    await fetch(`${BASE_URL}/class-teachers/${created.uuid}`, { method: 'DELETE', headers });
  });
});

describe('Timetable API — elective bands & offerings (co-scheduled options)', () => {
  it('creates a band with parallel offerings, then adds and removes one', async () => {
    const classId = await getClassId();
    const physics = await createSubject();
    const chemistry = await createSubject();
    const biology = await createSubject();

    let res = await fetch(`${BASE_URL}/elective-bands`, {
      method: 'POST', headers,
      body: JSON.stringify({
        academicYearId: TEST_ACADEMIC_YEAR_ID, classId, name: 'Science Option', periodsPerWeek: 6,
        blockRules: { blocks: [{ size: 1, count: 6 }] },
        offerings: [
          { subjectId: physics.uuid, teacherId: TEST_TEACHER_ID },
          { subjectId: chemistry.uuid, teacherId: TEST_TEACHER_ID_2 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const band = await res.json();
    expect(band.offerings.length).toBe(2);

    // add a third offering
    res = await fetch(`${BASE_URL}/elective-bands/${band.uuid}/offerings`, {
      method: 'POST', headers, body: JSON.stringify({ subjectId: biology.uuid, teacherId: TEST_TEACHER_ID }),
    });
    expect(res.status).toBe(200);
    const offering = await res.json();

    res = await fetch(`${BASE_URL}/elective-bands/${band.uuid}`, { headers });
    expect((await res.json()).offerings.length).toBe(3);

    // duplicate subject rejected
    res = await fetch(`${BASE_URL}/elective-bands/${band.uuid}/offerings`, {
      method: 'POST', headers, body: JSON.stringify({ subjectId: biology.uuid, teacherId: TEST_TEACHER_ID }),
    });
    expect(res.status).toBe(400);

    // remove offering
    res = await fetch(`${BASE_URL}/elective-offerings/${offering.uuid}`, { method: 'DELETE', headers });
    expect(res.status).toBe(200);
    res = await fetch(`${BASE_URL}/elective-bands/${band.uuid}`, { headers });
    expect((await res.json()).offerings.length).toBe(2);

    // delete band cascades to offerings
    res = await fetch(`${BASE_URL}/elective-bands/${band.uuid}`, { method: 'DELETE', headers });
    expect(res.status).toBe(200);
    res = await fetch(`${BASE_URL}/elective-bands/${band.uuid}`, { headers });
    expect(res.status).toBe(404);
  });
});

describe('Timetable API — teacher constraints', () => {
  it('creates and deletes a hard day-off constraint', async () => {
    let res = await fetch(`${BASE_URL}/teacher-constraints`, {
      method: 'POST', headers,
      body: JSON.stringify({
        academicYearId: TEST_ACADEMIC_YEAR_ID, teacherId: TEST_TEACHER_ID,
        constraintType: 'day_off', value: { day: 6 }, hardness: 'hard',
      }),
    });
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created.constraintType).toBe('day_off');
    expect(created.value).toEqual({ day: 6 });

    res = await fetch(`${BASE_URL}/teacher-constraints?teacherId=${TEST_TEACHER_ID}`, { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).constraints.some((c: any) => c.uuid === created.uuid)).toBe(true);

    res = await fetch(`${BASE_URL}/teacher-constraints/${created.uuid}`, { method: 'DELETE', headers });
    expect(res.status).toBe(200);
  });

  it('rejects an invalid constraint type', async () => {
    const res = await fetch(`${BASE_URL}/teacher-constraints`, {
      method: 'POST', headers,
      body: JSON.stringify({
        academicYearId: TEST_ACADEMIC_YEAR_ID, teacherId: TEST_TEACHER_ID,
        constraintType: 'nope', hardness: 'hard',
      }),
    });
    expect(res.status).toBe(400);
  });
});
