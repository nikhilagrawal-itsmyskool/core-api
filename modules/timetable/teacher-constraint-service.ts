import { DB, singleLineString } from '../../shared/lib/db';
import { TeacherConstraint, CreateTeacherConstraintRequest, UpdateTeacherConstraintRequest } from './timetable-interfaces';
import { DEFAULTS } from './timetable-constants';
import { toJsonb } from './timetable-util';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class TeacherConstraintService {
  public async list(schoolId: string, teacherId?: string, academicYearId?: string): Promise<TeacherConstraint[]> {
    const params: any[] = [schoolId];
    let where = `school_id = $1 and status = 'active'`;
    if (teacherId) { params.push(teacherId); where += ` and teacher_id = $${params.length}`; }
    if (academicYearId) { params.push(academicYearId); where += ` and academic_year_id = $${params.length}`; }
    return DB.query(
      singleLineString`select * from teacher_constraint where ${where} order by teacher_id, constraint_type`,
      params,
    );
  }

  public async getById(id: string, schoolId: string): Promise<TeacherConstraint | null> {
    const r = await DB.query(
      singleLineString`select * from teacher_constraint where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  public async create(data: CreateTeacherConstraintRequest, schoolId: string, userId: string): Promise<TeacherConstraint> {
    const r = await DB.query(
      singleLineString`
        insert into teacher_constraint
        (uuid, school_id, academic_year_id, teacher_id, constraint_type, value, hardness, weight, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        returning *
      `,
      [
        generateShortUuid(12), schoolId, data.academicYearId, data.teacherId, data.constraintType,
        toJsonb(data.value), data.hardness, data.weight ?? null, DEFAULTS.STATUS, userId, new Date(),
      ],
    );
    return r[0];
  }

  public async update(id: string, data: UpdateTeacherConstraintRequest, schoolId: string, userId: string): Promise<TeacherConstraint | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    const value = data.value !== undefined ? data.value : existing.value;
    const hardness = data.hardness !== undefined ? data.hardness : existing.hardness;
    const weight = data.weight !== undefined ? data.weight : existing.weight ?? null;
    const r = await DB.query(
      singleLineString`
        update teacher_constraint
        set value = $1, hardness = $2, weight = $3, updatedby_userid = $4, updated_at = $5
        where uuid = $6 and school_id = $7 and status = 'active'
        returning *
      `,
      [toJsonb(value), hardness, weight, userId, new Date(), id, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    await DB.query(
      singleLineString`
        update teacher_constraint
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
  }
}

export const teacherConstraintService = new TeacherConstraintService();
