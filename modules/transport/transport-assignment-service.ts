import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { CreateAssignmentRequest, TransportAssignment, UpdateAssignmentRequest } from './transport-interfaces';
import { DEFAULTS } from './transport-constants';
import { academicYearExists, findStudent } from './transport-common';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class TransportAssignmentService {
  public async create(data: CreateAssignmentRequest, schoolId: string, userId: string): Promise<TransportAssignment> {
    if (!data.academicYearId || !data.studentId || !data.routeId || !data.stopId) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'academicYearId, studentId, routeId and stopId are required');
    }
    if (!(await academicYearExists(schoolId, data.academicYearId))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'academicYearId does not reference a valid academic year');
    }
    const student = await findStudent(schoolId, data.studentId);
    if (!student) throw new BusinessErrorResult(ErrorCode.BusinessError, 'studentId does not reference an active student');

    const route = await this.getActiveRoute(schoolId, data.routeId);
    await this.assertStopOnRoute(schoolId, data.routeId, data.stopId);

    // One assignment per student per direction per academic year.
    const dup = await DB.query(
      singleLineString`
        select uuid from transport_student_assignment
        where school_id = $1 and academic_year_id = $2 and student_id = $3 and direction = $4 and status = 'active'
      `,
      [schoolId, data.academicYearId, data.studentId, route.direction],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Student already has a ${route.direction} assignment for this year`);
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into transport_student_assignment
        (uuid, school_id, academic_year_id, student_id, route_id, stop_id, direction, student_name, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        returning *
      `,
      [uuid, schoolId, data.academicYearId, data.studentId, data.routeId, data.stopId, route.direction, student.name, DEFAULTS.STATUS, userId, now],
    );
    return rows[0];
  }

  public async update(id: string, data: UpdateAssignmentRequest, schoolId: string, userId: string): Promise<TransportAssignment | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;

    const newRouteId = data.routeId ?? existing.routeId;
    const newStopId = data.stopId ?? existing.stopId;

    // A route change must keep the same direction (a student's two assignments are
    // distinct rows; switching morning<->evening is a delete + create, not an edit).
    const route = await this.getActiveRoute(schoolId, newRouteId);
    if (route.direction !== existing.direction) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Cannot move a ${existing.direction} assignment to a ${route.direction} route`);
    }
    await this.assertStopOnRoute(schoolId, newRouteId, newStopId);

    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        update transport_student_assignment
        set route_id = $1, stop_id = $2, updatedby_userid = $3, updated_at = $4
        where uuid = $5 and school_id = $6 and status = 'active'
        returning *
      `,
      [newRouteId, newStopId, userId, now, id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return false;
    await DB.query(
      singleLineString`
        update transport_student_assignment set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
    return true;
  }

  public async getById(id: string, schoolId: string): Promise<TransportAssignment | null> {
    const rows = await DB.query(
      singleLineString`select * from transport_student_assignment where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async list(schoolId: string, filters: { routeId?: string; studentId?: string; academicYearId?: string; direction?: string }): Promise<any[]> {
    const params: any[] = [schoolId];
    const clauses: string[] = ['a.school_id = $1', `a.status = 'active'`];
    const add = (col: string, val?: string) => { if (val) { params.push(val); clauses.push(`${col} = $${params.length}`); } };
    add('a.route_id', filters.routeId);
    add('a.student_id', filters.studentId);
    add('a.academic_year_id', filters.academicYearId);
    add('a.direction', filters.direction);

    return DB.query(
      singleLineString`
        select a.*, s.name as stop_name, s.km::float8 as stop_km, r.name as route_name
        from transport_student_assignment a
        left join transport_stop s on s.uuid = a.stop_id
        left join transport_route r on r.uuid = a.route_id
        where ${clauses.join(' and ')}
        order by a.student_name, a.direction
      `,
      params,
    );
  }

  // Roster for a route: its active assignments (used by attendance + route detail).
  public async routeRoster(schoolId: string, routeId: string): Promise<any[]> {
    return DB.query(
      singleLineString`
        select a.student_id, a.student_name as name, a.stop_id, s.name as stop_name
        from transport_student_assignment a
        left join transport_stop s on s.uuid = a.stop_id
        where a.school_id = $1 and a.route_id = $2 and a.status = 'active'
        order by a.student_name
      `,
      [schoolId, routeId],
    );
  }

  // Per-student transport view: both morning + evening assignments for a year.
  public async studentReport(schoolId: string, studentId: string, academicYearId?: string): Promise<any> {
    const params: any[] = [schoolId, studentId];
    let query = singleLineString`
      select a.direction, a.academic_year_id, a.route_id, r.name as route_name,
             a.stop_id, s.name as stop_name, s.km::float8 as stop_km,
             r.driver_name, r.driver_phone, r.conductor_name, r.conductor_phone,
             v.registration_number as vehicle_registration_number
      from transport_student_assignment a
      left join transport_route r on r.uuid = a.route_id
      left join transport_stop s on s.uuid = a.stop_id
      left join transport_vehicle v on v.uuid = r.vehicle_id
      where a.school_id = $1 and a.student_id = $2 and a.status = 'active'
    `;
    if (academicYearId) { params.push(academicYearId); query += ` and a.academic_year_id = $${params.length}`; }
    const rows = await DB.query(query, params);
    const morning = rows.find((r: any) => r.direction === 'morning') || null;
    const evening = rows.find((r: any) => r.direction === 'evening') || null;
    return { studentId, morning, evening };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async getActiveRoute(schoolId: string, routeId: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select uuid, direction from transport_route where uuid = $1 and school_id = $2 and status = 'active'`,
      [routeId, schoolId],
    );
    if (rows.length === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, 'routeId does not reference a valid route');
    return rows[0];
  }

  private async assertStopOnRoute(schoolId: string, routeId: string, stopId: string): Promise<void> {
    const rows = await DB.query(
      singleLineString`select 1 from transport_route_stop where route_id = $1 and stop_id = $2 and school_id = $3 and status = 'active'`,
      [routeId, stopId, schoolId],
    );
    if (rows.length === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, 'stopId is not a stop on the selected route');
  }
}

export const transportAssignmentService = new TransportAssignmentService();
