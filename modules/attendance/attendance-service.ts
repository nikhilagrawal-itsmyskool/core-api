import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ATTENDANCE_STATUS_VALUES, DEFAULTS } from './attendance-constants';
import {
  AttendanceSession, AttendanceRecord, RosterEntry, MarkEntry, EditRecordRequest,
} from './attendance-interfaces';
import { notifyAbsences, nonTeachingDateSet } from './attendance-util';
import { istToday } from '../../shared/util/datetime';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

function assertStatus(status: string): void {
  if (!(ATTENDANCE_STATUS_VALUES as readonly string[]).includes(status)) {
    throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid status "${status}"`);
  }
}

// Select list for attendance_session that returns attendance_date as a plain
// 'YYYY-MM-DD' string. node-pg parses a `date` column to a local-midnight Date,
// which JSON-serializes to UTC and shifts the day in UTC+ timezones — so we
// format it in SQL instead.
const SESSION_COLS = singleLineString`
  uuid, school_id, academic_year_id, class_id,
  to_char(attendance_date, 'YYYY-MM-DD') as attendance_date,
  status, finalized_at, createdby_userid, created_at, updatedby_userid, updated_at
`;
const SESSION_COLS_S = singleLineString`
  s.uuid, s.school_id, s.academic_year_id, s.class_id,
  to_char(s.attendance_date, 'YYYY-MM-DD') as attendance_date,
  s.status, s.finalized_at, s.createdby_userid, s.created_at, s.updatedby_userid, s.updated_at
`;

class AttendanceService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const results = await DB.query(
      singleLineString`select uuid from school where lower(code) = lower($1)`,
      [schoolCode],
    );
    return results.length > 0 ? results[0].uuid : null;
  }

  // Enrolled, active students for a class in an academic year (the roster source).
  private async getEnrolled(schoolId: string, classId: string, academicYearId: string): Promise<any[]> {
    return DB.query(
      singleLineString`
        select st.uuid as student_id, st.name, st.admission_number
        from student st
        join student_class sc on sc.student_id = st.uuid and sc.school_id = st.school_id
        where sc.class_id = $1 and sc.academic_year_id = $2 and st.school_id = $3 and st.status = 'active'
        order by st.name
      `,
      [classId, academicYearId, schoolId],
    );
  }

  private async findSession(schoolId: string, classId: string, academicYearId: string, date: string): Promise<AttendanceSession | null> {
    const rows = await DB.query(
      singleLineString`
        select ${SESSION_COLS} from attendance_session
        where school_id = $1 and academic_year_id = $2 and class_id = $3 and attendance_date = $4
      `,
      [schoolId, academicYearId, classId, date],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async getSessionById(schoolId: string, sessionId: string): Promise<AttendanceSession | null> {
    const rows = await DB.query(
      singleLineString`select ${SESSION_COLS} from attendance_session where uuid = $1 and school_id = $2`,
      [sessionId, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // Roster for the marking screen: enrolled students merged with any existing marks.
  public async getRoster(schoolId: string, classId: string, academicYearId: string, date: string): Promise<{ session: AttendanceSession | null; students: RosterEntry[] }> {
    const enrolled = await this.getEnrolled(schoolId, classId, academicYearId);
    const session = await this.findSession(schoolId, classId, academicYearId, date);

    const marks = new Map<string, { status: string; remark?: string }>();
    if (session) {
      const records = await DB.query(
        singleLineString`select student_id, status, remark from attendance_record where session_id = $1`,
        [session.uuid],
      );
      for (const r of records) marks.set(r.studentId, { status: r.status, remark: r.remark });
    }

    const students: RosterEntry[] = enrolled.map((e: any) => {
      const m = marks.get(e.studentId);
      return { studentId: e.studentId, name: e.name, admissionNumber: e.admissionNumber, status: m?.status as any, remark: m?.remark };
    });
    return { session, students };
  }

  // Create/open the session for a class+date, or return the existing one (idempotent).
  public async openSession(schoolId: string, classId: string, academicYearId: string, date: string, userId: string): Promise<AttendanceSession> {
    const existing = await this.findSession(schoolId, classId, academicYearId, date);
    if (existing) return existing;

    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into attendance_session
        (uuid, school_id, academic_year_id, class_id, attendance_date, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, 'open', $6, $7)
        on conflict (school_id, academic_year_id, class_id, attendance_date) do nothing
        returning ${SESSION_COLS}
      `,
      [uuid, schoolId, academicYearId, classId, date, userId, now],
    );
    // on conflict (a concurrent create) -> fetch the winner
    if (rows.length === 0) {
      return (await this.findSession(schoolId, classId, academicYearId, date))!;
    }
    return rows[0];
  }

  // Save marked exceptions (UI sends only non-present students). Upserts records
  // and writes an audit row for every status change.
  public async saveMarks(schoolId: string, sessionId: string, marks: MarkEntry[], userId: string): Promise<{ saved: number } | null> {
    const session = await this.getSessionById(schoolId, sessionId);
    if (!session) return null;
    if (session.status === 'finalized') {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Session is finalized — edit individual records instead');
    }

    const existingRows = await DB.query(
      singleLineString`select uuid, student_id, status from attendance_record where session_id = $1`,
      [sessionId],
    );
    const existing = new Map<string, { uuid: string; status: string }>();
    for (const r of existingRows) existing.set(r.studentId, { uuid: r.uuid, status: r.status });

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();

    for (const m of marks) {
      assertStatus(m.status);
      const prev = existing.get(m.studentId);
      if (prev) {
        queries.push(singleLineString`
          update attendance_record set status = $1, remark = $2, updatedby_userid = $3, updated_at = $4 where uuid = $5
        `);
        params.push([m.status, m.remark ?? null, userId, now, prev.uuid]);
        if (prev.status !== m.status) {
          queries.push(singleLineString`
            insert into attendance_audit (uuid, school_id, session_id, record_id, student_id, old_status, new_status, source, changedby_userid, changed_at)
            values ($1, $2, $3, $4, $5, $6, $7, 'mark', $8, $9)
          `);
          params.push([generateShortUuid(12), schoolId, sessionId, prev.uuid, m.studentId, prev.status, m.status, userId, now]);
        }
      } else {
        const recordId = generateShortUuid(12);
        queries.push(singleLineString`
          insert into attendance_record (uuid, school_id, session_id, student_id, status, remark, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `);
        params.push([recordId, schoolId, sessionId, m.studentId, m.status, m.remark ?? null, userId, now]);
        queries.push(singleLineString`
          insert into attendance_audit (uuid, school_id, session_id, record_id, student_id, old_status, new_status, source, changedby_userid, changed_at)
          values ($1, $2, $3, $4, $5, null, $6, 'mark', $7, $8)
        `);
        params.push([generateShortUuid(12), schoolId, sessionId, recordId, m.studentId, m.status, userId, now]);
      }
    }

    if (queries.length > 0) await DB.queriesInTransaction(queries, params);
    return { saved: marks.length };
  }

  // Finalize: fill unmarked enrolled students as 'present', lock the session, then
  // notify the families of absent students (once).
  public async finalize(schoolId: string, sessionId: string, schoolCode: string, userId: string): Promise<any | null> {
    const session = await this.getSessionById(schoolId, sessionId);
    if (!session) return null;

    if (session.status !== 'finalized') {
      const enrolled = await this.getEnrolled(schoolId, session.classId, session.academicYearId);
      const existingRows = await DB.query(
        singleLineString`select student_id from attendance_record where session_id = $1`,
        [sessionId],
      );
      const marked = new Set<string>(existingRows.map((r: any) => r.studentId));

      const queries: string[] = [];
      const params: any[][] = [];
      const now = new Date();

      for (const e of enrolled) {
        if (marked.has(e.studentId)) continue;
        const recordId = generateShortUuid(12);
        queries.push(singleLineString`
          insert into attendance_record (uuid, school_id, session_id, student_id, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, 'present', $5, $6)
        `);
        params.push([recordId, schoolId, sessionId, e.studentId, userId, now]);
        queries.push(singleLineString`
          insert into attendance_audit (uuid, school_id, session_id, record_id, student_id, old_status, new_status, source, changedby_userid, changed_at)
          values ($1, $2, $3, $4, $5, null, 'present', 'finalize', $6, $7)
        `);
        params.push([generateShortUuid(12), schoolId, sessionId, recordId, e.studentId, userId, now]);
      }

      queries.push(singleLineString`
        update attendance_session set status = 'finalized', finalized_at = $1, updatedby_userid = $2, updated_at = $1 where uuid = $3
      `);
      params.push([now, userId, sessionId]);

      await DB.queriesInTransaction(queries, params);
    }

    // Absent students for the (now finalized) session.
    const absentRows = await DB.query(
      singleLineString`select student_id from attendance_record where session_id = $1 and status = 'absent'`,
      [sessionId],
    );
    const absentIds = absentRows.map((r: any) => r.studentId);

    // Notify only on the first finalize (not on a re-finalize call), and ONLY for
    // the current day. Back-dated finalizes (correcting a past day's roll-call)
    // must not fire SMS — families would get "absent today" alerts for a day that
    // has already passed. attendance_date is 'YYYY-MM-DD'; compare to today (IST).
    let notifiedJobId: string | null = null;
    const isToday = String(session.attendanceDate).slice(0, 10) === istToday();
    if (session.status !== 'finalized' && absentIds.length > 0 && isToday) {
      const classRows = await DB.query(
        singleLineString`select name from class where uuid = $1 and school_id = $2`,
        [session.classId, schoolId],
      );
      const className = classRows.length > 0 ? classRows[0].name : '';
      notifiedJobId = await notifyAbsences(schoolCode, absentIds, {
        className,
        date: String(session.attendanceDate).slice(0, 10),
      });
    }

    const summary = await this.statusCounts(sessionId);
    return { sessionId, status: 'finalized', counts: summary, absentCount: absentIds.length, notifiedJobId };
  }

  private async statusCounts(sessionId: string): Promise<Record<string, number>> {
    const rows = await DB.query(
      singleLineString`select status, count(*)::int as count from attendance_record where session_id = $1 group by status`,
      [sessionId],
    );
    const counts: Record<string, number> = { present: 0, absent: 0, late: 0, leave: 0 };
    for (const r of rows) counts[r.status] = r.count;
    return counts;
  }

  // Session detail: records (with student names) + the change-history audit log.
  public async getSessionDetail(schoolId: string, sessionId: string): Promise<any | null> {
    const session = await this.getSessionById(schoolId, sessionId);
    if (!session) return null;
    const records = await DB.query(
      singleLineString`
        select r.*, st.name as student_name, st.admission_number
        from attendance_record r
        left join student st on st.uuid = r.student_id
        where r.session_id = $1 and r.school_id = $2
        order by st.name
      `,
      [sessionId, schoolId],
    );
    const audit = await DB.query(
      singleLineString`
        select a.*, st.name as student_name
        from attendance_audit a
        left join student st on st.uuid = a.student_id
        where a.session_id = $1 and a.school_id = $2
        order by a.changed_at desc
      `,
      [sessionId, schoolId],
    );
    return { session, records, audit };
  }

  public async listSessions(schoolId: string, filters: { classId?: string; academicYearId?: string; from?: string; to?: string }): Promise<any[]> {
    const params: any[] = [schoolId];
    const clauses: string[] = ['s.school_id = $1'];
    if (filters.classId) { params.push(filters.classId); clauses.push(`s.class_id = $${params.length}`); }
    if (filters.academicYearId) { params.push(filters.academicYearId); clauses.push(`s.academic_year_id = $${params.length}`); }
    if (filters.from) { params.push(filters.from); clauses.push(`s.attendance_date >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); clauses.push(`s.attendance_date <= $${params.length}`); }

    return DB.query(
      singleLineString`
        select ${SESSION_COLS_S},
          count(r.uuid) filter (where r.status = 'present')::int as present_count,
          count(r.uuid) filter (where r.status = 'absent')::int as absent_count,
          count(r.uuid)::int as marked_count
        from attendance_session s
        left join attendance_record r on r.session_id = s.uuid
        where ${clauses.join(' and ')}
        group by s.uuid
        order by s.attendance_date desc
      `,
      params,
    );
  }

  // Edit a single record (the post-finalize correction path). Writes an audit row
  // on status change. Does NOT re-notify (notification fires only on finalize).
  public async editRecord(schoolId: string, recordId: string, data: EditRecordRequest, userId: string): Promise<AttendanceRecord | null> {
    const rows = await DB.query(
      singleLineString`select * from attendance_record where uuid = $1 and school_id = $2`,
      [recordId, schoolId],
    );
    if (rows.length === 0) return null;
    const record = rows[0];
    const newStatus = data.status ?? record.status;
    if (data.status) assertStatus(data.status);

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();

    queries.push(singleLineString`
      update attendance_record set status = $1, remark = $2, updatedby_userid = $3, updated_at = $4 where uuid = $5
    `);
    params.push([newStatus, data.remark !== undefined ? data.remark : record.remark, userId, now, recordId]);

    if (newStatus !== record.status) {
      queries.push(singleLineString`
        insert into attendance_audit (uuid, school_id, session_id, record_id, student_id, old_status, new_status, source, changedby_userid, changed_at)
        values ($1, $2, $3, $4, $5, $6, $7, 'edit', $8, $9)
      `);
      params.push([generateShortUuid(12), schoolId, record.sessionId, recordId, record.studentId, record.status, newStatus, userId, now]);
    }

    await DB.queriesInTransaction(queries, params);
    const updated = await DB.query(singleLineString`select * from attendance_record where uuid = $1`, [recordId]);
    return updated[0];
  }

  // Parent-app view: one student's attendance across finalized sessions, newest
  // first, plus a rolled-up summary. Only finalized sessions count — an open
  // (mid-marking) session isn't a fact yet. `percent` treats present + late as
  // attended.
  public async getStudentAttendance(
    schoolId: string,
    studentId: string,
    filters: { academicYearId?: string; from?: string; to?: string },
  ): Promise<{ summary: Record<string, number>; days: any[] }> {
    const params: any[] = [schoolId, studentId];
    const clauses: string[] = ['sess.school_id = $1', 'r.student_id = $2', `sess.status = 'finalized'`];
    if (filters.academicYearId) { params.push(filters.academicYearId); clauses.push(`sess.academic_year_id = $${params.length}`); }
    if (filters.from) { params.push(filters.from); clauses.push(`sess.attendance_date >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); clauses.push(`sess.attendance_date <= $${params.length}`); }

    const days = await DB.query(
      singleLineString`
        select to_char(sess.attendance_date, 'YYYY-MM-DD') as date,
               r.status, r.remark, c.name as class_name
        from attendance_record r
        join attendance_session sess on sess.uuid = r.session_id
        left join class c on c.uuid = sess.class_id
        where ${clauses.join(' and ')}
        order by sess.attendance_date desc
      `,
      params,
    );

    // Exclude declared holidays + weekly-off days from the % denominator with
    // certainty (e.g. a session accidentally finalized on a holiday shouldn't count).
    // Each such day is flagged nonTeaching so the 360 view can render it distinctly.
    let ntSet = new Set<string>();
    if (filters.academicYearId && days.length) {
      const from = days[days.length - 1].date; // days are DESC, so last is earliest
      const to = days[0].date;
      ntSet = await nonTeachingDateSet(schoolId, filters.academicYearId, from, to);
    }

    const summary: Record<string, number> = { present: 0, absent: 0, late: 0, leave: 0, total: 0, percent: 0 };
    for (const d of days) {
      d.nonTeaching = ntSet.has(d.date);
      if (d.nonTeaching) continue; // holiday/weekly-off: not part of the working denominator
      if (summary[d.status] !== undefined) summary[d.status]++;
      summary.total++;
    }
    summary.percent = summary.total > 0
      ? Math.round(((summary.present + summary.late) / summary.total) * 100)
      : 0;

    return { summary, days };
  }

  // Class attendance register for a date range: the enrolled roster as rows, the
  // finalized session dates as columns, and each student's per-day status +
  // totals. Mirrors a physical register (blank cell = no mark that day).
  public async getClassRegister(
    schoolId: string,
    classId: string,
    academicYearId: string,
    from: string,
    to: string,
  ): Promise<{ dates: string[]; students: any[] }> {
    const dateRows = await DB.query(
      singleLineString`
        select to_char(attendance_date, 'YYYY-MM-DD') as d
        from attendance_session
        where school_id = $1 and class_id = $2 and academic_year_id = $3
          and status = 'finalized' and attendance_date between $4 and $5
        order by attendance_date
      `,
      [schoolId, classId, academicYearId, from, to],
    );
    const dates = dateRows.map((r: any) => r.d);

    const roster = await DB.query(
      singleLineString`
        select sc.student_id, s.name, s.admission_number, sc.roll_number
        from student_class sc
        join student s on s.uuid = sc.student_id and s.school_id = sc.school_id
        where sc.school_id = $1 and sc.class_id = $2 and sc.academic_year_id = $3
          and (sc.status is null or sc.status <> 'deleted') and s.status <> 'deleted'
        order by sc.roll_number nulls last, s.name
      `,
      [schoolId, classId, academicYearId],
    );

    const marks = await DB.query(
      singleLineString`
        select r.student_id, to_char(sess.attendance_date, 'YYYY-MM-DD') as d, r.status
        from attendance_record r
        join attendance_session sess on sess.uuid = r.session_id
        where sess.school_id = $1 and sess.class_id = $2 and sess.academic_year_id = $3
          and sess.status = 'finalized' and sess.attendance_date between $4 and $5
      `,
      [schoolId, classId, academicYearId, from, to],
    );
    const byStudent = new Map<string, Record<string, string>>();
    for (const m of marks) {
      if (!byStudent.has(m.studentId)) byStudent.set(m.studentId, {});
      byStudent.get(m.studentId)![m.d] = m.status;
    }

    // Non-teaching days (full holidays + weekly-off) don't count toward working days,
    // so the percentage is correct even if a session was created on such a day.
    const ntSet = await nonTeachingDateSet(schoolId, academicYearId, from, to);

    const students = roster.map((st: any) => {
      const map = byStudent.get(st.studentId) || {};
      let present = 0, absent = 0, leave = 0, late = 0;
      for (const d of dates) {
        if (ntSet.has(d)) continue; // holiday / weekly-off — excluded from working days
        const s = map[d];
        if (s === 'present') present++;
        else if (s === 'absent') absent++;
        else if (s === 'leave') leave++;
        else if (s === 'late') late++;
      }
      const working = present + absent + late; // leave excluded, matching the source
      return {
        studentId: st.studentId, name: st.name, admissionNumber: st.admissionNumber,
        rollNumber: st.rollNumber, marks: map,
        present, absent, leave, late, working,
        percent: working > 0 ? Math.round(((present + late) / working) * 100) : 0,
      };
    });

    return { dates, students };
  }
}

export const attendanceService = new AttendanceService();
