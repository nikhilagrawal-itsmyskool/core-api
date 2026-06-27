import { BASE_URL, headers, getEnrolledClass, uniqueDate, closePool } from './helpers';

afterAll(async () => {
  await closePool();
});

async function openSession(classId: string, academicYearId: string, date: string) {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: 'POST', headers, body: JSON.stringify({ classId, academicYearId, date }),
  });
  if (res.status !== 200) throw new Error(`openSession failed (${res.status}): ${await res.text()}`);
  return res.json();
}

describe('Attendance API', () => {
  it('roster lists enrolled students for a class/date', async () => {
    const { classId, academicYearId, studentIds } = await getEnrolledClass();
    const date = uniqueDate();
    const res = await fetch(`${BASE_URL}/roster?classId=${classId}&academicYearId=${academicYearId}&date=${date}`, { headers });
    expect(res.status).toBe(200);
    const { students } = await res.json();
    expect(students.length).toBe(studentIds.length);
    expect(students[0].studentId).toBeDefined();
  });

  it('open → mark absentee → finalize fills the rest present, with audit', async () => {
    const { classId, academicYearId, studentIds } = await getEnrolledClass();
    const date = uniqueDate();

    const session = await openSession(classId, academicYearId, date);
    expect(session.status).toBe('open');

    // mark only the first student absent (exceptions UX)
    let res = await fetch(`${BASE_URL}/sessions/${session.uuid}/marks`, {
      method: 'PUT', headers,
      body: JSON.stringify({ marks: [{ studentId: studentIds[0], status: 'absent', remark: 'sick' }] }),
    });
    expect(res.status).toBe(200);

    // finalize
    res = await fetch(`${BASE_URL}/sessions/${session.uuid}/finalize`, { method: 'POST', headers });
    expect(res.status).toBe(200);
    const fin = await res.json();
    expect(fin.status).toBe('finalized');
    expect(fin.counts.absent).toBe(1);
    expect(fin.counts.present).toBe(studentIds.length - 1);
    expect(fin.absentCount).toBe(1);

    // detail: one record per enrolled student + audit rows (1 mark + fills on finalize)
    res = await fetch(`${BASE_URL}/sessions/${session.uuid}`, { headers });
    const detail = await res.json();
    expect(detail.records.length).toBe(studentIds.length);
    const sources = detail.audit.map((a: any) => a.source);
    expect(sources).toContain('mark');
    expect(sources).toContain('finalize');
  });

  it('saving marks on a finalized session is rejected', async () => {
    const { classId, academicYearId, studentIds } = await getEnrolledClass();
    const date = uniqueDate();
    const session = await openSession(classId, academicYearId, date);
    await fetch(`${BASE_URL}/sessions/${session.uuid}/finalize`, { method: 'POST', headers });

    const res = await fetch(`${BASE_URL}/sessions/${session.uuid}/marks`, {
      method: 'PUT', headers,
      body: JSON.stringify({ marks: [{ studentId: studentIds[0], status: 'absent' }] }),
    });
    expect(res.status).not.toBe(200);
  });

  it('editing a finalized record writes an edit audit row', async () => {
    const { classId, academicYearId, studentIds } = await getEnrolledClass();
    const date = uniqueDate();
    const session = await openSession(classId, academicYearId, date);
    await fetch(`${BASE_URL}/sessions/${session.uuid}/finalize`, { method: 'POST', headers });

    // grab a present record and flip it to leave
    let res = await fetch(`${BASE_URL}/sessions/${session.uuid}`, { headers });
    let detail = await res.json();
    const present = detail.records.find((r: any) => r.status === 'present');
    expect(present).toBeDefined();

    res = await fetch(`${BASE_URL}/records/${present.uuid}`, {
      method: 'PUT', headers, body: JSON.stringify({ status: 'leave' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('leave');

    res = await fetch(`${BASE_URL}/sessions/${session.uuid}`, { headers });
    detail = await res.json();
    const editAudit = detail.audit.find((a: any) => a.source === 'edit' && a.studentId === present.studentId);
    expect(editAudit).toBeDefined();
    expect(editAudit.oldStatus).toBe('present');
    expect(editAudit.newStatus).toBe('leave');
  });

  it('back-dates attendance to a past date and lists it', async () => {
    const { classId, academicYearId } = await getEnrolledClass();
    const date = uniqueDate(); // a date in the past
    const session = await openSession(classId, academicYearId, date);
    expect(String(session.attendanceDate).slice(0, 10)).toBe(date);

    const res = await fetch(`${BASE_URL}/sessions?classId=${classId}&academicYearId=${academicYearId}&from=2015-01-01&to=2030-01-01`, { headers });
    const { sessions } = await res.json();
    expect(sessions.some((s: any) => s.uuid === session.uuid)).toBe(true);
  });
});
