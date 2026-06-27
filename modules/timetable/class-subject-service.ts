import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ClassSubject, CreateClassSubjectRequest, UpdateClassSubjectRequest } from './timetable-interfaces';
import { DEFAULTS } from './timetable-constants';
import { validateBlockRules, toJsonb } from './timetable-util';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class ClassSubjectService {
  // List class_subjects, optionally filtered by class and/or academic year.
  public async list(schoolId: string, classId?: string, academicYearId?: string): Promise<ClassSubject[]> {
    const params: any[] = [schoolId];
    let where = `cs.school_id = $1 and cs.status = 'active'`;
    if (classId) { params.push(classId); where += ` and cs.class_id = $${params.length}`; }
    if (academicYearId) { params.push(academicYearId); where += ` and cs.academic_year_id = $${params.length}`; }
    return DB.query(
      singleLineString`
        select cs.*, s.name as subject_name, s.code as subject_code, s.status as subject_status
        from class_subject cs
        left join subject s on s.uuid = cs.subject_id
        where ${where}
        order by s.name
      `,
      params,
    );
  }

  public async getById(id: string, schoolId: string): Promise<ClassSubject | null> {
    const results = await DB.query(
      singleLineString`
        select cs.*, s.name as subject_name
        from class_subject cs
        left join subject s on s.uuid = cs.subject_id
        where cs.uuid = $1 and cs.school_id = $2 and cs.status = 'active'
      `,
      [id, schoolId],
    );
    return results.length > 0 ? results[0] : null;
  }

  public async create(data: CreateClassSubjectRequest, schoolId: string, userId: string): Promise<ClassSubject> {
    const blockErr = validateBlockRules(data.blockRules, data.periodsPerWeek);
    if (blockErr) throw new BusinessErrorResult(ErrorCode.BusinessError, blockErr);

    const dup = await DB.query(
      singleLineString`
        select 1 from class_subject
        where school_id = $1 and academic_year_id = $2 and class_id = $3 and subject_id = $4 and status = 'active' limit 1
      `,
      [schoolId, data.academicYearId, data.classId, data.subjectId],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'This subject is already assigned to the class for this year');
    }

    const results = await DB.query(
      singleLineString`
        insert into class_subject
        (uuid, school_id, academic_year_id, class_id, subject_id, periods_per_week, block_rules, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning *
      `,
      [
        generateShortUuid(12), schoolId, data.academicYearId, data.classId, data.subjectId,
        data.periodsPerWeek, toJsonb(data.blockRules), DEFAULTS.STATUS, userId, new Date(),
      ],
    );
    return this.getById(results[0].uuid, schoolId) as Promise<ClassSubject>;
  }

  public async update(id: string, data: UpdateClassSubjectRequest, schoolId: string, userId: string): Promise<ClassSubject | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;

    const periodsPerWeek = data.periodsPerWeek !== undefined ? data.periodsPerWeek : existing.periodsPerWeek;
    const blockRules = data.blockRules !== undefined ? data.blockRules : existing.blockRules;
    const blockErr = validateBlockRules(blockRules, periodsPerWeek);
    if (blockErr) throw new BusinessErrorResult(ErrorCode.BusinessError, blockErr);

    await DB.query(
      singleLineString`
        update class_subject
        set periods_per_week = $1, block_rules = $2, updatedby_userid = $3, updated_at = $4
        where uuid = $5 and school_id = $6 and status = 'active'
      `,
      [periodsPerWeek, toJsonb(blockRules), userId, new Date(), id, schoolId],
    );
    return this.getById(id, schoolId);
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    await DB.query(
      singleLineString`
        update class_subject
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
  }
}

export const classSubjectService = new ClassSubjectService();
