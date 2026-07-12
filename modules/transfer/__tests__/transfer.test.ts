import { BASE_URL, headers, createTestPool, getSchoolId, seedStudent, uid } from './helpers';

describe('Transfer (TC) API', () => {
  let pool: any;
  let schoolId: string;
  let studentId: string;
  const tag = `t${uid()}`.slice(0, 9);

  beforeAll(async () => {
    pool = createTestPool();
    schoolId = await getSchoolId(pool);
    studentId = await seedStudent(pool, schoolId, tag);
  });

  afterAll(async () => {
    await pool.query(`delete from student_tc where student_id = $1`, [studentId]);
    await pool.query(`delete from student where uuid = $1`, [studentId]);
    await pool.end();
  });

  it('health responds', async () => {
    const res = await fetch(`${BASE_URL}/health`, { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).module).toBe('transfer');
  });

  it('applies for a TC without withdrawing the student', async () => {
    const res = await fetch(`${BASE_URL}/students/${studentId}/tc`, {
      method: 'POST', headers,
      body: JSON.stringify({ applicationDate: '2026-03-01', reasonForLeaving: 'Relocation' }),
    });
    expect(res.status).toBe(200);
    const tc = await res.json();
    expect(tc.status).toBe('applied');

    const st = await pool.query(`select status from student where uuid = $1`, [studentId]);
    expect(st.rows[0].status).toBe('active');
  });

  it('issuing a TC withdraws the student (status inactive + withdrawal_date)', async () => {
    const created = await (await fetch(`${BASE_URL}/students/${studentId}/tc`, {
      method: 'POST', headers,
      body: JSON.stringify({ applicationDate: '2026-03-05' }),
    })).json();

    const res = await fetch(`${BASE_URL}/students/${studentId}/tc/${created.uuid}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ status: 'issued', srnNumber: 'SRN-123', issueDate: '2026-03-10', totalAttendanceDays: 180, totalWorkingDays: 200 }),
    });
    expect(res.status).toBe(200);
    const tc = await res.json();
    expect(tc.status).toBe('issued');
    expect(tc.srnNumber).toBe('SRN-123');

    const st = await pool.query(`select status, withdrawal_date from student where uuid = $1`, [studentId]);
    expect(st.rows[0].status).toBe('inactive');
    expect(st.rows[0].withdrawalDate || st.rows[0].withdrawal_date).toBeTruthy();
  });
});
