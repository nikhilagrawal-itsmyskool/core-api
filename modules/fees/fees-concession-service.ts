import { DB, singleLineString } from '../../shared/lib/db';
import { ErrorCode } from '../../shared/lib/error-codes';
import { BadRequestResult } from '../../shared/lib/errors';
import { CONCESSION_TYPES, CONCESSION_VALUE_TYPES } from './fees-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

export interface CreateConcessionRequest {
  academicYearId: string;
  name: string;
  type: string;
  valueType: string;
  value: number;
  feeHeadId?: string;
}

export interface UpdateConcessionRequest {
  name?: string;
  type?: string;
  valueType?: string;
  value?: number;
  feeHeadId?: string;
}

export interface AddConcessionStudentsRequest {
  studentIds: string[];
  cycleScope?: string;
  remarks?: string;
  attachmentFileId?: string;
}

class ConcessionService {
  public async create(data: CreateConcessionRequest, schoolId: string, userId: string): Promise<any> {
    if (!data.academicYearId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required'); }
    if (!data.name || !data.name.trim()) { throw new BadRequestResult(ErrorCode.InvalidInput, 'name is required'); }
    if (!data.type || !CONCESSION_TYPES.includes(data.type as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `type must be one of: ${CONCESSION_TYPES.join(', ')}`);
    }
    if (!data.valueType || !CONCESSION_VALUE_TYPES.includes(data.valueType as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `valueType must be one of: ${CONCESSION_VALUE_TYPES.join(', ')}`);
    }
    if (data.value === undefined || data.value === null) { throw new BadRequestResult(ErrorCode.InvalidInput, 'value is required'); }

    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into fee_concession
      (uuid, school_id, academic_year_id, name, type, value_type, value, fee_head_id, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10)
      returning *
    `;

    const params = [
      uuid,
      schoolId,
      data.academicYearId,
      data.name,
      data.type,
      data.valueType,
      data.value,
      data.feeHeadId ?? null,
      userId,
      now,
    ];

    const results = await DB.query(query, params);
    return results[0];
  }

  public async update(id: string, data: UpdateConcessionRequest, schoolId: string, userId: string): Promise<any | null> {
    if (data.type !== undefined && !CONCESSION_TYPES.includes(data.type as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `type must be one of: ${CONCESSION_TYPES.join(', ')}`);
    }
    if (data.valueType !== undefined && !CONCESSION_VALUE_TYPES.includes(data.valueType as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `valueType must be one of: ${CONCESSION_VALUE_TYPES.join(', ')}`);
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.name !== undefined) { updates.push(`name = $${i++}`); params.push(data.name); }
    if (data.type !== undefined) { updates.push(`type = $${i++}`); params.push(data.type); }
    if (data.valueType !== undefined) { updates.push(`value_type = $${i++}`); params.push(data.valueType); }
    if (data.value !== undefined) { updates.push(`value = $${i++}`); params.push(data.value); }
    if (data.feeHeadId !== undefined) { updates.push(`fee_head_id = $${i++}`); params.push(data.feeHeadId); }

    if (updates.length === 0) {
      return this.getById(id, schoolId);
    }

    updates.push(`updatedby_userid = $${i++}`); params.push(userId);
    updates.push(`updated_at = $${i++}`); params.push(new Date());
    params.push(id);
    params.push(schoolId);

    const query = singleLineString`
      update fee_concession set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
      returning *
    `;

    const results = await DB.query(query, params);
    return results.length > 0 ? results[0] : null;
  }

  public async remove(id: string, schoolId: string, userId: string): Promise<any | null> {
    const query = singleLineString`
      update fee_concession set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async getById(id: string, schoolId: string): Promise<any | null> {
    const results = await DB.query(
      singleLineString`select * from fee_concession where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async list(schoolId: string, academicYearId?: string, includeDeleted?: boolean): Promise<any[]> {
    const params: any[] = [schoolId];
    let sql = `select * from fee_concession where school_id = $1`;
    if (!includeDeleted) { sql += ` and status = 'active'`; }
    if (academicYearId) { params.push(academicYearId); sql += ` and academic_year_id = $${params.length}`; }
    sql += ` order by name`;
    return DB.query(sql, params);
  }

  // ---- Concession roster (fee_concession_student) ----

  // Roster with the student's name + this-year class (joined server-side so the UI doesn't
  // fire one lookup per student). class_name is null when the student isn't enrolled in the
  // concession's academic year (e.g. left the school) — the UI can flag/hide those.
  public async listStudents(concessionId: string, schoolId: string, includeDeleted?: boolean): Promise<any[]> {
    const params: any[] = [schoolId, concessionId];
    let sql = singleLineString`
      select cs.*, s.name as student_name, s.admission_number, s.status as student_status,
             c.name as class_name, (sc.uuid is not null) as enrolled_this_year
      from fee_concession_student cs
      join fee_concession fc on fc.uuid = cs.concession_id
      left join student s on s.uuid = cs.student_id and s.school_id = cs.school_id
      left join student_class sc on sc.student_id = cs.student_id and sc.academic_year_id = fc.academic_year_id and sc.school_id = cs.school_id
      left join class c on c.uuid = sc.class_id
      where cs.school_id = $1 and cs.concession_id = $2`;
    if (!includeDeleted) { sql += ` and cs.status = 'active'`; }
    sql += ` order by s.name nulls last`;
    return DB.query(sql, params);
  }

  public async addStudents(concessionId: string, data: AddConcessionStudentsRequest, schoolId: string, userId: string): Promise<any> {
    if (!Array.isArray(data.studentIds) || data.studentIds.length === 0) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'studentIds is required');
    }

    const existing = await DB.query(
      singleLineString`
        select student_id from fee_concession_student
        where school_id = $1 and concession_id = $2 and student_id = any($3) and status = 'active'
      `,
      [schoolId, concessionId, data.studentIds]
    );
    const existingSet = new Set<string>(existing.map((r: any) => r.studentId));

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();

    for (const studentId of data.studentIds) {
      if (existingSet.has(studentId)) { continue; }
      queries.push(singleLineString`
        insert into fee_concession_student
        (uuid, school_id, concession_id, student_id, cycle_scope, remarks, attachment_file_id, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
      `);
      params.push([
        generateShortUuid(12),
        schoolId,
        concessionId,
        studentId,
        data.cycleScope ?? null,
        data.remarks ?? null,
        data.attachmentFileId ?? null,
        userId,
        now,
      ]);
    }

    if (queries.length > 0) {
      await DB.queriesInTransaction(queries, params);
    }
    return { added: queries.length };
  }

  public async removeStudent(concessionId: string, studentId: string, schoolId: string, userId: string): Promise<any | null> {
    const query = singleLineString`
      update fee_concession_student set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where school_id = $3 and concession_id = $4 and student_id = $5 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), schoolId, concessionId, studentId]);
    return results.length > 0 ? results[0] : null;
  }
}

export const concessionService = new ConcessionService();
