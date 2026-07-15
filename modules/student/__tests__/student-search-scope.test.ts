import { BASE_URL, headers, createFixtures, cleanupFixtures, createStudent, Fixtures } from './helpers';
import { createTestPool } from './helpers';

// Covers the academic-session scoping work:
//  - search filters by academicYearId even WITHOUT a classId (the bug fix)
//  - omni-search flags/pins current-year students (inCurrentYear)
//  - class-strength board: active head-count + last admission per class
describe('Student search — academic-session scoping', () => {
  let pool: any;
  let f: Fixtures;
  let s1: any; // yearFrom / classA
  let s2a: any; // yearTo / classB, earlier admission
  let s2b: any; // yearTo / classB, latest admission

  beforeAll(async () => {
    pool = createTestPool();
    f = await createFixtures(pool);

    s1 = await createStudent({
      name: `${f.tag}-Alice`, admissionNumber: `${f.tag}S1`,
      classId: f.classAId, academicYearId: f.yearFromId, admissionDate: '2025-05-01',
    });
    s2a = await createStudent({
      name: `${f.tag}-Bob`, admissionNumber: `${f.tag}S2a`,
      classId: f.classBId, academicYearId: f.yearToId, admissionDate: '2026-05-01',
    });
    s2b = await createStudent({
      name: `${f.tag}-Carol`, admissionNumber: `${f.tag}S2b`,
      classId: f.classBId, academicYearId: f.yearToId, admissionDate: '2026-06-01',
    });
  });

  afterAll(async () => {
    await cleanupFixtures(pool, f);
    await pool.end();
  });

  it('search by academicYearId WITHOUT classId scopes to that year', async () => {
    const res = await fetch(`${BASE_URL}/search?academicYearId=${f.yearFromId}&admissionNumber=${f.tag}`, { headers });
    expect(res.status).toBe(200);
    const rows = await res.json();
    const nums = rows.map((r: any) => r.admissionNumber);
    expect(nums).toContain(`${f.tag}S1`);
    expect(nums).not.toContain(`${f.tag}S2a`);
    expect(nums).not.toContain(`${f.tag}S2b`);
  });

  it('search by the other year returns only that year’s enrollees', async () => {
    const res = await fetch(`${BASE_URL}/search?academicYearId=${f.yearToId}&admissionNumber=${f.tag}`, { headers });
    const nums = (await res.json()).map((r: any) => r.admissionNumber);
    expect(nums).toEqual(expect.arrayContaining([`${f.tag}S2a`, `${f.tag}S2b`]));
    expect(nums).not.toContain(`${f.tag}S1`);
  });

  it('omni-search flags current-year students via inCurrentYear', async () => {
    const res = await fetch(`${BASE_URL}/omni-search?q=${f.tag}&academicYearId=${f.yearToId}&limit=30`, { headers });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    const byNum = (n: string) => results.find((r: any) => r.admissionNumber === n);
    expect(byNum(`${f.tag}S2b`).inCurrentYear).toBe(true);
    expect(byNum(`${f.tag}S1`).inCurrentYear).toBe(false);
  });

  it('class-strength returns active head-count + last admission per class', async () => {
    const res = await fetch(`${BASE_URL}/class-strength?academicYearId=${f.yearToId}`, { headers });
    expect(res.status).toBe(200);
    const { academicYearId, classes } = await res.json();
    expect(academicYearId).toBe(f.yearToId);
    const b = classes.find((c: any) => c.classId === f.classBId);
    expect(b).toBeDefined();
    expect(Number(b.activeStrength)).toBe(2);
    // Last admission = the enrollee with the most recent admission_date (Carol).
    expect(b.lastAdmissionNumber).toBe(`${f.tag}S2b`);
    expect(b.lastAdmissionName).toBe(`${f.tag}-Carol`);
  });
});

describe('Academic year — isCurrent flag', () => {
  it('marks exactly one year as current', async () => {
    const res = await fetch(`${BASE_URL.replace('/student', '/academic-year')}/search`, { headers });
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('isCurrent');
    expect(rows.filter((r: any) => r.isCurrent === true).length).toBe(1);
  });
});
