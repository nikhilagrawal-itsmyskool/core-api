import {
  BASE_URL,
  headers,
  getClassIds,
  createSubject,
  uniqueYearId,
  TEST_TEACHER_ID,
  TEST_TEACHER_ID_2,
  closePool,
} from "./helpers";

afterAll(async () => {
  await closePool();
});

// Seed a section's setup: a class subject, a teaching assignment, a class teacher,
// and an elective band with two offerings. Returns ids for later cleanup/assert.
async function seedSection(classId: string, yearId: string) {
  const math = await createSubject();
  const physics = await createSubject();
  const chemistry = await createSubject();

  let res = await fetch(`${BASE_URL}/class-subjects`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      academicYearId: yearId,
      classId,
      subjectId: math.uuid,
      periodsPerWeek: 6,
      blockRules: { blocks: [{ size: 1, count: 6 }] },
    }),
  });
  expect(res.status).toBe(200);

  res = await fetch(`${BASE_URL}/teaching-assignments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      academicYearId: yearId,
      classId,
      subjectId: math.uuid,
      teacherId: TEST_TEACHER_ID,
      periodShare: 6,
    }),
  });
  expect(res.status).toBe(200);

  res = await fetch(`${BASE_URL}/class-teachers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      academicYearId: yearId,
      classId,
      teacherId: TEST_TEACHER_ID,
      firstPeriodSubjectId: math.uuid,
      firstPeriodDays: [1, 2, 3],
    }),
  });
  expect(res.status).toBe(200);

  res = await fetch(`${BASE_URL}/elective-bands`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      academicYearId: yearId,
      classId,
      name: "Science Option",
      periodsPerWeek: 6,
      blockRules: { blocks: [{ size: 1, count: 6 }] },
      offerings: [
        { subjectId: physics.uuid, teacherId: TEST_TEACHER_ID },
        { subjectId: chemistry.uuid, teacherId: TEST_TEACHER_ID_2 },
      ],
    }),
  });
  expect(res.status).toBe(200);

  return { mathId: math.uuid };
}

describe("Timetable API — clone class setup", () => {
  it("clones a section's full setup onto an empty target section", async () => {
    const [source, target] = await getClassIds(2);
    const yearId = uniqueYearId();
    const { mathId } = await seedSection(source, yearId);

    const res = await fetch(`${BASE_URL}/clone-class-setup`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sourceClassId: source,
        targetClassId: target,
        academicYearId: yearId,
      }),
    });
    expect(res.status).toBe(200);
    const summary = await res.json();
    expect(summary).toEqual({
      classSubjects: 1,
      teachingAssignments: 1,
      electiveBands: 1,
      electiveOfferings: 2,
    });

    // Target now has the copied rows.
    const csRes = await fetch(
      `${BASE_URL}/class-subjects?classId=${target}&academicYearId=${yearId}`,
      { headers },
    );
    const cs = (await csRes.json()).classSubjects;
    expect(cs.length).toBe(1);
    expect(cs[0].subjectId).toBe(mathId);
    expect(cs[0].classId).toBe(target);

    // The class teacher is intentionally NOT cloned — target stays blank.
    const ctRes = await fetch(
      `${BASE_URL}/class-teachers?classId=${target}&academicYearId=${yearId}`,
      { headers },
    );
    const ct = (await ctRes.json()).classTeachers;
    expect(ct.length).toBe(0);

    const bandRes = await fetch(
      `${BASE_URL}/elective-bands?classId=${target}&academicYearId=${yearId}`,
      { headers },
    );
    const bands = (await bandRes.json()).bands;
    expect(bands.length).toBe(1);
    expect(bands[0].offerings.length).toBe(2);
  });

  it("clones even when the target already has a class teacher set", async () => {
    const [source, target] = await getClassIds(2);
    const yearId = uniqueYearId();
    await seedSection(source, yearId);

    // Pre-set the target's class teacher (the per-section difference).
    let res = await fetch(`${BASE_URL}/class-teachers`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        academicYearId: yearId,
        classId: target,
        teacherId: TEST_TEACHER_ID_2,
      }),
    });
    expect(res.status).toBe(200);

    res = await fetch(`${BASE_URL}/clone-class-setup`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sourceClassId: source,
        targetClassId: target,
        academicYearId: yearId,
      }),
    });
    expect(res.status).toBe(200);

    // The pre-set class teacher is untouched (still one, still teacher 2).
    const ctRes = await fetch(
      `${BASE_URL}/class-teachers?classId=${target}&academicYearId=${yearId}`,
      { headers },
    );
    const ct = (await ctRes.json()).classTeachers;
    expect(ct.length).toBe(1);
    expect(ct[0].teacherId).toBe(TEST_TEACHER_ID_2);
  });

  it("rejects cloning onto a target that already has setup", async () => {
    const [source, target] = await getClassIds(2);
    const yearId = uniqueYearId();
    await seedSection(source, yearId);
    await seedSection(target, yearId); // target not empty

    const res = await fetch(`${BASE_URL}/clone-class-setup`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sourceClassId: source,
        targetClassId: target,
        academicYearId: yearId,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects when source and target are the same section", async () => {
    const [source] = await getClassIds(1);
    const res = await fetch(`${BASE_URL}/clone-class-setup`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sourceClassId: source,
        targetClassId: source,
        academicYearId: uniqueYearId(),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid target class", async () => {
    const [source] = await getClassIds(1);
    const res = await fetch(`${BASE_URL}/clone-class-setup`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sourceClassId: source,
        targetClassId: "nope-class-id",
        academicYearId: uniqueYearId(),
      }),
    });
    expect(res.status).toBe(400);
  });
});
