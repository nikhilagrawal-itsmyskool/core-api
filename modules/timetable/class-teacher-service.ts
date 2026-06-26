import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ClassTeacher, CreateClassTeacherRequest, UpdateClassTeacherRequest } from './timetable-interfaces';
import { DEFAULTS } from './timetable-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class ClassTeacherService {
  public async list(schoolId: string, classId?: string, academicYearId?: string): Promise<ClassTeacher[]> {
    const params: any[] = [schoolId];
    let where = `school_id = $1 and status = 'active'`;
    if (classId) { params.push(classId); where += ` and class_id = $${params.length}`; }
    if (academicYearId) { params.push(academicYearId); where += ` and academic_year_id = $${params.length}`; }
    return DB.query(
      singleLineString`select * from class_teacher where ${where} order by created_at`,
      params,
    );
  }

  public async getById(id: string, schoolId: string): Promise<ClassTeacher | null> {
    const results = await DB.query(
      singleLineString`select * from class_teacher where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return results.length > 0 ? results[0] : null;
  }

  public async create(data: CreateClassTeacherRequest, schoolId: string, userId: string): Promise<ClassTeacher> {
    const dup = await DB.query(
      singleLineString`
        select 1 from class_teacher
        where school_id = $1 and academic_year_id = $2 and class_id = $3 and status = 'active' limit 1
      `,
      [schoolId, data.academicYearId, data.classId],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'This class already has a class teacher for this year');
    }

    const results = await DB.query(
      singleLineString`
        insert into class_teacher
        (uuid, school_id, academic_year_id, class_id, teacher_id, first_period_subject_id, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning *
      `,
      [generateShortUuid(12), schoolId, data.academicYearId, data.classId, data.teacherId, data.firstPeriodSubjectId ?? null, DEFAULTS.STATUS, userId, new Date()],
    );
    return results[0];
  }

  public async update(id: string, data: UpdateClassTeacherRequest, schoolId: string, userId: string): Promise<ClassTeacher | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    // Each field is optional and updated independently; omitted = unchanged.
    const teacherId = data.teacherId !== undefined ? data.teacherId : existing.teacherId;
    const firstPeriodSubjectId = data.firstPeriodSubjectId !== undefined
      ? data.firstPeriodSubjectId
      : existing.firstPeriodSubjectId ?? null;
    const results = await DB.query(
      singleLineString`
        update class_teacher
        set teacher_id = $1, first_period_subject_id = $2, updatedby_userid = $3, updated_at = $4
        where uuid = $5 and school_id = $6 and status = 'active'
        returning *
      `,
      [teacherId, firstPeriodSubjectId, userId, new Date(), id, schoolId],
    );
    return results.length > 0 ? results[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    await DB.query(
      singleLineString`
        update class_teacher
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
  }
}

export const classTeacherService = new ClassTeacherService();
