import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ATTENDANCE_STATUS_VALUES, DEFAULTS } from './transport-constants';
import {
  EditRecordRequest, MarkEntry, RosterEntry, TransportAttendanceRecord, TransportAttendanceSession,
} from './transport-interfaces';
import { transportAssignmentService } from './transport-assignment-service';
import { notifyTransportAbsences } from './transport-util';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

function assertStatus(status: string): void {
  if (!(ATTENDANCE_STATUS_VALUES as readonly string[]).includes(status)) {
    throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid status "${status}"`);
  }
}

// attendance_date is returned as a plain 'YYYY-MM-DD' string to avoid the node-pg
// local-midnight-Date -> UTC day-shift gotcha (same as the attendance module).
const SESSION_COLS = singleLineString`
  uuid, school_id, academic_year_id, route_id,
  to_char(attendance_date, 'YYYY-MM-DD') as attendance_date,
  status, finalized_at, createdby_userid, created_at, updatedby_userid, updated_at
`;
const SESSION_COLS_S = singleLineString`
  s.uuid, s.school_id, s.academic_year_id, s.route_id,
  to_char(s.attendance_date, 'YYYY-MM-DD') as attendance_date,
  s.status, s.finalized_at, s.createdby_userid, s.created_at, s.updatedby_userid, s.updated_at
`;

class TransportAttendanceService {
  private async findSession(schoolId: string, routeId: string, date: string): Promise<TransportAttendanceSession | null> {
    const rows = await DB.query(
      singleLineString`
        select ${SESSION_COLS} from transport_attendance_session
        where school_id = $1 and route_id = $2 and attendance_date = $3
      `,
      [schoolId, routeId, date],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async getSessionById(schoolId: string, sessionId: string): Promise<TransportAttendanceSession | null> {
    const rows = await DB.query(
      singleLineString`select ${SESSION_COLS} from transport_attendance_session where uuid = $1 and school_id = $2`,
      [sessionId, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // Roster for the marking screen: assigned students merged with any existing marks.
  public async getRoster(schoolId: string, routeId: string, date: string): Promise<{ session: TransportAttendanceSession | null; students: RosterEntry[] }> {
    const roster = await transportAssignmentService.routeRoster(schoolId, routeId);
    const session = await this.findSession(schoolId, routeId, date);

    const marks = new Map<string, { status: string; remark?: string }>();
    if (session) {
      const records = await DB.query(
        singleLineString`select student_id, status, remark from transport_attendance_record where session_id = $1`,
        [session.uuid],
      );
      for (const r of records) marks.set(r.studentId, { status: r.status, remark: r.remark });
    }

    const students: RosterEntry[] = roster.map((e: any) => {
      const m = marks.get(e.studentId);
      return { studentId: e.studentId, name: e.name, stopId: e.stopId, stopName: e.stopName, status: m?.status as any, remark: m?.remark };
    });
    return { session, students };
  }

  // Create/open the session for a route+date, or return the existing one (idempotent).
  public async openSession(schoolId: string, routeId: string, academicYearId: string, date: string, userId: string): Promise<TransportAttendanceSession> {
    const existing = await this.findSession(schoolId, routeId, date);
    if (existing) return existing;

    // Validate the route exists (and is active) before opening a session.
    const route = await DB.query(
      singleLineString`select uuid from transport_route where uuid = $1 and school_id = $2 and status = 'active'`,
      [routeId, schoolId],
    );
    if (route.length === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, 'routeId does not reference a valid route');

    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into transport_attendance_session
        (uuid, school_id, academic_year_id, route_id, attendance_date, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, 'open', $6, $7)
        on conflict (school_id, route_id, attendance_date) do nothing
        returning ${SESSION_COLS}
      `,
      [uuid, schoolId, academicYearId, routeId, date, userId, now],
    );
    if (rows.length === 0) {
      return (await this.findSession(schoolId, routeId, date))!;
    }
    return rows[0];
  }

  // Save marked exceptions (UI sends only non-boarded students). Upserts records
  // and writes an audit row for every status change.
  public async saveMarks(schoolId: string, sessionId: string, marks: MarkEntry[], userId: string): Promise<{ saved: number } | null> {
    const session = await this.getSessionById(schoolId, sessionId);
    if (!session) return null;
    if (session.status === 'finalized') {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Session is finalized — edit individual records instead');
    }

    const existingRows = await DB.query(
      singleLineString`select uuid, student_id, status from transport_attendance_record where session_id = $1`,
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
          update transport_attendance_record set status = $1, remark = $2, updatedby_userid = $3, updated_at = $4 where uuid = $5
        `);
        params.push([m.status, m.remark ?? null, userId, now, prev.uuid]);
        if (prev.status !== m.status) {
          queries.push(singleLineString`
            insert into transport_attendance_audit (uuid, school_id, session_id, record_id, student_id, old_status, new_status, source, changedby_userid, changed_at)
            values ($1, $2, $3, $4, $5, $6, $7, 'mark', $8, $9)
          `);
          params.push([generateShortUuid(12), schoolId, sessionId, prev.uuid, m.studentId, prev.status, m.status, userId, now]);
        }
      } else {
        const recordId = generateShortUuid(12);
        queries.push(singleLineString`
          insert into transport_attendance_record (uuid, school_id, session_id, student_id, status, remark, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `);
        params.push([recordId, schoolId, sessionId, m.studentId, m.status, m.remark ?? null, userId, now]);
        queries.push(singleLineString`
          insert into transport_attendance_audit (uuid, school_id, session_id, record_id, student_id, old_status, new_status, source, changedby_userid, changed_at)
          values ($1, $2, $3, $4, $5, null, $6, 'mark', $7, $8)
        `);
        params.push([generateShortUuid(12), schoolId, sessionId, recordId, m.studentId, m.status, userId, now]);
      }
    }

    if (queries.length > 0) await DB.queriesInTransaction(queries, params);
    return { saved: marks.length };
  }

  // Finalize: fill unmarked assigned students as 'boarded', lock the session, then
  // notify the families of absent students (once).
  public async finalize(schoolId: string, sessionId: string, schoolCode: string, userId: string): Promise<any | null> {
    const session = await this.getSessionById(schoolId, sessionId);
    if (!session) return null;

    if (session.status !== 'finalized') {
      const roster = await transportAssignmentService.routeRoster(schoolId, session.routeId);
      const existingRows = await DB.query(
        singleLineString`select student_id from transport_attendance_record where session_id = $1`,
        [sessionId],
      );
      const marked = new Set<string>(existingRows.map((r: any) => r.studentId));

      const queries: string[] = [];
      const params: any[][] = [];
      const now = new Date();

      for (const e of roster) {
        if (marked.has(e.studentId)) continue;
        const recordId = generateShortUuid(12);
        queries.push(singleLineString`
          insert into transport_attendance_record (uuid, school_id, session_id, student_id, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, 'boarded', $5, $6)
        `);
        params.push([recordId, schoolId, sessionId, e.studentId, userId, now]);
        queries.push(singleLineString`
          insert into transport_attendance_audit (uuid, school_id, session_id, record_id, student_id, old_status, new_status, source, changedby_userid, changed_at)
          values ($1, $2, $3, $4, $5, null, 'boarded', 'finalize', $6, $7)
        `);
        params.push([generateShortUuid(12), schoolId, sessionId, recordId, e.studentId, userId, now]);
      }

      queries.push(singleLineString`
        update transport_attendance_session set status = 'finalized', finalized_at = $1, updatedby_userid = $2, updated_at = $1 where uuid = $3
      `);
      params.push([now, userId, sessionId]);

      await DB.queriesInTransaction(queries, params);
    }

    const absentRows = await DB.query(
      singleLineString`select student_id from transport_attendance_record where session_id = $1 and status = 'absent'`,
      [sessionId],
    );
    const absentIds = absentRows.map((r: any) => r.studentId);

    let notifiedJobId: string | null = null;
    if (session.status !== 'finalized' && absentIds.length > 0) {
      const routeRows = await DB.query(
        singleLineString`select name, direction from transport_route where uuid = $1 and school_id = $2`,
        [session.routeId, schoolId],
      );
      const routeName = routeRows.length > 0 ? routeRows[0].name : '';
      const direction = routeRows.length > 0 ? routeRows[0].direction : '';
      notifiedJobId = await notifyTransportAbsences(schoolCode, absentIds, {
        routeName,
        direction,
        date: String(session.attendanceDate).slice(0, 10),
      });
    }

    const counts = await this.statusCounts(sessionId);
    return { sessionId, status: 'finalized', counts, absentCount: absentIds.length, notifiedJobId };
  }

  private async statusCounts(sessionId: string): Promise<Record<string, number>> {
    const rows = await DB.query(
      singleLineString`select status, count(*)::int as count from transport_attendance_record where session_id = $1 group by status`,
      [sessionId],
    );
    const counts: Record<string, number> = { boarded: 0, absent: 0, excused: 0 };
    for (const r of rows) counts[r.status] = r.count;
    return counts;
  }

  public async getSessionDetail(schoolId: string, sessionId: string): Promise<any | null> {
    const session = await this.getSessionById(schoolId, sessionId);
    if (!session) return null;
    const records = await DB.query(
      singleLineString`
        select r.*, st.name as student_name
        from transport_attendance_record r
        left join student st on st.uuid = r.student_id
        where r.session_id = $1 and r.school_id = $2
        order by st.name
      `,
      [sessionId, schoolId],
    );
    const audit = await DB.query(
      singleLineString`
        select a.*, st.name as student_name
        from transport_attendance_audit a
        left join student st on st.uuid = a.student_id
        where a.session_id = $1 and a.school_id = $2
        order by a.changed_at desc
      `,
      [sessionId, schoolId],
    );
    return { session, records, audit };
  }

  public async listSessions(schoolId: string, filters: { routeId?: string; academicYearId?: string; from?: string; to?: string }): Promise<any[]> {
    const params: any[] = [schoolId];
    const clauses: string[] = ['s.school_id = $1'];
    if (filters.routeId) { params.push(filters.routeId); clauses.push(`s.route_id = $${params.length}`); }
    if (filters.academicYearId) { params.push(filters.academicYearId); clauses.push(`s.academic_year_id = $${params.length}`); }
    if (filters.from) { params.push(filters.from); clauses.push(`s.attendance_date >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); clauses.push(`s.attendance_date <= $${params.length}`); }

    return DB.query(
      singleLineString`
        select ${SESSION_COLS_S}, r.name as route_name, r.direction,
          count(rec.uuid) filter (where rec.status = 'boarded')::int as boarded_count,
          count(rec.uuid) filter (where rec.status = 'absent')::int as absent_count,
          count(rec.uuid)::int as marked_count
        from transport_attendance_session s
        left join transport_route r on r.uuid = s.route_id
        left join transport_attendance_record rec on rec.session_id = s.uuid
        where ${clauses.join(' and ')}
        group by s.uuid, r.name, r.direction
        order by s.attendance_date desc
      `,
      params,
    );
  }

  public async editRecord(schoolId: string, recordId: string, data: EditRecordRequest, userId: string): Promise<TransportAttendanceRecord | null> {
    const rows = await DB.query(
      singleLineString`select * from transport_attendance_record where uuid = $1 and school_id = $2`,
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
      update transport_attendance_record set status = $1, remark = $2, updatedby_userid = $3, updated_at = $4 where uuid = $5
    `);
    params.push([newStatus, data.remark !== undefined ? data.remark : record.remark, userId, now, recordId]);

    if (newStatus !== record.status) {
      queries.push(singleLineString`
        insert into transport_attendance_audit (uuid, school_id, session_id, record_id, student_id, old_status, new_status, source, changedby_userid, changed_at)
        values ($1, $2, $3, $4, $5, $6, $7, 'edit', $8, $9)
      `);
      params.push([generateShortUuid(12), schoolId, record.sessionId, recordId, record.studentId, record.status, newStatus, userId, now]);
    }

    await DB.queriesInTransaction(queries, params);
    const updated = await DB.query(singleLineString`select * from transport_attendance_record where uuid = $1`, [recordId]);
    return updated[0];
  }
}

export const transportAttendanceService = new TransportAttendanceService();
