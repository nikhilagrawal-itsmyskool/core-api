import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { TeachingAssignment, CreateTeachingAssignmentRequest, UpdateTeachingAssignmentRequest } from './timetable-interfaces';
import { DEFAULTS } from './timetable-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class TeachingAssignmentService {
  public async list(schoolId: string, classId?: string, teacherId?: string, academicYearId?: string): Promise<TeachingAssignment[]> {
    const params: any[] = [schoolId];
    let where = `ta.school_id = $1 and ta.status = 'active'`;
    if (classId) { params.push(classId); where += ` and ta.class_id = $${params.length}`; }
    if (teacherId) { params.push(teacherId); where += ` and ta.teacher_id = $${params.length}`; }
    if (academicYearId) { params.push(academicYearId); where += ` and ta.academic_year_id = $${params.length}`; }
    return DB.query(
      singleLineString`
        select ta.*, s.name as subject_name
        from teaching_assignment ta
        left join subject s on s.uuid = ta.subject_id
        where ${where}
        order by s.name
      `,
      params,
    );
  }

  public async getById(id: string, schoolId: string): Promise<TeachingAssignment | null> {
    const results = await DB.query(
      singleLineString`
        select ta.*, s.name as subject_name
        from teaching_assignment ta
        left join subject s on s.uuid = ta.subject_id
        where ta.uuid = $1 and ta.school_id = $2 and ta.status = 'active'
      `,
      [id, schoolId],
    );
    return results.length > 0 ? results[0] : null;
  }

  public async create(data: CreateTeachingAssignmentRequest, schoolId: string, userId: string): Promise<TeachingAssignment> {
    const dup = await DB.query(
      singleLineString`
        select 1 from teaching_assignment
        where school_id = $1 and academic_year_id = $2 and class_id = $3 and subject_id = $4 and teacher_id = $5 and status = 'active' limit 1
      `,
      [schoolId, data.academicYearId, data.classId, data.subjectId, data.teacherId],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'This teacher is already assigned to that class+subject for this year');
    }

    const results = await DB.query(
      singleLineString`
        insert into teaching_assignment
        (uuid, school_id, academic_year_id, class_id, subject_id, teacher_id, period_share, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning *
      `,
      [
        generateShortUuid(12), schoolId, data.academicYearId, data.classId, data.subjectId,
        data.teacherId, data.periodShare ?? null, DEFAULTS.STATUS, userId, new Date(),
      ],
    );
    return this.getById(results[0].uuid, schoolId) as Promise<TeachingAssignment>;
  }

  public async update(id: string, data: UpdateTeachingAssignmentRequest, schoolId: string, userId: string): Promise<TeachingAssignment | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    const periodShare = data.periodShare !== undefined ? data.periodShare : existing.periodShare ?? null;
    await DB.query(
      singleLineString`
        update teaching_assignment
        set period_share = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5 and status = 'active'
      `,
      [periodShare, userId, new Date(), id, schoolId],
    );
    return this.getById(id, schoolId);
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    await DB.query(
      singleLineString`
        update teaching_assignment
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
  }
}

export const teachingAssignmentService = new TeachingAssignmentService();
