import { DB, singleLineString } from '../../shared/lib/db';
import { ErrorCode } from '../../shared/lib/error-codes';
import { BadRequestResult } from '../../shared/lib/errors';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

export interface CreateWaiverRequest {
  academicYearId: string;
  studentId: string;
  feeHeadId?: string;
  cycleId?: string;
  reason?: string;
}

class WaiverService {
  public async create(data: CreateWaiverRequest, schoolId: string, userId: string): Promise<any> {
    if (!data.academicYearId) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required');
    }
    if (!data.studentId) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'studentId is required');
    }

    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into fee_waiver
      (uuid, school_id, academic_year_id, student_id, fee_head_id, cycle_id, reason, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
      returning *
    `;

    const params = [
      uuid,
      schoolId,
      data.academicYearId,
      data.studentId,
      data.feeHeadId ?? null,
      data.cycleId ?? null,
      data.reason ?? null,
      userId,
      now,
    ];

    const results = await DB.query(query, params);
    return results[0];
  }

  public async remove(id: string, schoolId: string, userId: string): Promise<any | null> {
    const query = singleLineString`
      update fee_waiver set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async list(schoolId: string, studentId?: string, academicYearId?: string, includeDeleted?: boolean): Promise<any[]> {
    const params: any[] = [schoolId];
    let sql = `select * from fee_waiver where school_id = $1`;
    if (!includeDeleted) { sql += ` and status = 'active'`; }
    if (studentId) { params.push(studentId); sql += ` and student_id = $${params.length}`; }
    if (academicYearId) { params.push(academicYearId); sql += ` and academic_year_id = $${params.length}`; }
    sql += ` order by created_at desc`;
    return DB.query(sql, params);
  }
}

export const waiverService = new WaiverService();
