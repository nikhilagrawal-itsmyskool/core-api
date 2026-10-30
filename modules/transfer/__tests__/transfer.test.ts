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

  it('config: get returns defaults, update round-trips', async () => {
    const got = await (await fetch(`${BASE_URL}/config`, { headers })).json();
    expect(got.duesGateMode).toBeDefined();
    expect(Array.isArray(got.resultOptions)).toBe(true);

    const upd = await (await fetch(`${BASE_URL}/config`, {
      method: 'PUT', headers,
      body: JSON.stringify({ duesGateMode: 'warn', defaultConduct: 'VERY GOOD', tcBookNo: '2/2022' }),
    })).json();
    expect(upd.duesGateMode).toBe('warn');
    expect(upd.defaultConduct).toBe('VERY GOOD');
    expect(upd.tcBookNo).toBe('2/2022');
  });

  it('prefill returns derived identity + config + suggested defaults', async () => {
    const pf = await (await fetch(`${BASE_URL}/students/${studentId}/tc/prefill`, { headers })).json();
    expect(pf.derived?.name).toContain('TcKid');
    expect(pf.config).toBeDefined();
    expect(pf.suggested).toBeDefined();
    expect(pf.suggested.bookNo).toBe('2/2022'); // from the config set above
  });

  it('updating a TC updates the same row (no duplicate)', async () => {
    const created = await (await fetch(`${BASE_URL}/students/${studentId}/tc`, {
      method: 'POST', headers,
      body: JSON.stringify({ applicationDate: '2026-04-01', reasonForLeaving: 'A' }),
    })).json();
    const before = await pool.query(`select count(*)::int c from student_tc where student_id = $1 and status <> 'deleted'`, [studentId]);

    const updated = await (await fetch(`${BASE_URL}/students/${studentId}/tc/${created.uuid}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ reasonForLeaving: 'B', generalConduct: 'EXCELLENT' }),
    })).json();
    expect(updated.uuid).toBe(created.uuid);
    expect(updated.reasonForLeaving).toBe('B');

    const after = await pool.query(`select count(*)::int c from student_tc where student_id = $1 and status <> 'deleted'`, [studentId]);
    expect(after.rows[0].c).toBe(before.rows[0].c); // update must NOT create a new row
  });

  it('print returns the certificate HTML', async () => {
    const created = await (await fetch(`${BASE_URL}/students/${studentId}/tc`, {
      method: 'POST', headers,
      body: JSON.stringify({ applicationDate: '2026-04-02', result: 'EXCELLENT', generalConduct: 'EXCELLENT' }),
    })).json();
    const res = await fetch(`${BASE_URL}/students/${studentId}/tc/${created.uuid}/print`, { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('TRANSFER CERTIFICATE');
    expect(html).toContain('TcKid');
  });

  it('public verify resolves an issued TC by uuid (no auth header)', async () => {
    const created = await (await fetch(`${BASE_URL}/students/${studentId}/tc`, {
      method: 'POST', headers,
      body: JSON.stringify({ status: 'issued', tcNumber: 'TC/999', issueDate: '2026-04-03' }),
    })).json();
    const res = await fetch(`${BASE_URL}/verify/tc/${created.uuid}`, { headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(200);
    const v = await res.json();
    expect(v.valid).toBe(true);
    expect(v.tcNumber).toBe('TC/999');
  });
});
