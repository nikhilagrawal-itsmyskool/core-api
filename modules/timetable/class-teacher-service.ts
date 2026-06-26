import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  ClassTeacher,
  CreateClassTeacherRequest,
  UpdateClassTeacherRequest,
} from "./timetable-interfaces";
import { DEFAULTS } from "./timetable-constants";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// Serialize a number[] for a jsonb column. A raw JS array param would be coerced
// to a Postgres array literal (which a jsonb column rejects), so stringify it and
// let Postgres cast the text to jsonb. null/undefined → null (= all teaching days).
function toJsonbArray(value: number[] | null | undefined): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

class ClassTeacherService {
  public async list(
    schoolId: string,
    classId?: string,
    academicYearId?: string,
  ): Promise<ClassTeacher[]> {
    const params: any[] = [schoolId];
    let where = `school_id = $1 and status = 'active'`;
    if (classId) {
      params.push(classId);
      where += ` and class_id = $${params.length}`;
    }
    if (academicYearId) {
      params.push(academicYearId);
      where += ` and academic_year_id = $${params.length}`;
    }
    return DB.query(
      singleLineString`select * from class_teacher where ${where} order by created_at`,
      params,
    );
  }

  public async getById(
    id: string,
    schoolId: string,
  ): Promise<ClassTeacher | null> {
    const results = await DB.query(
      singleLineString`select * from class_teacher where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return results.length > 0 ? results[0] : null;
  }

  public async create(
    data: CreateClassTeacherRequest,
    schoolId: string,
    userId: string,
  ): Promise<ClassTeacher> {
    const dup = await DB.query(
      singleLineString`
        select 1 from class_teacher
        where school_id = $1 and academic_year_id = $2 and class_id = $3 and status = 'active' limit 1
      `,
      [schoolId, data.academicYearId, data.classId],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "This class already has a class teacher for this year",
      );
    }

    const results = await DB.query(
      singleLineString`
        insert into class_teacher
        (uuid, school_id, academic_year_id, class_id, teacher_id, first_period_subject_id, first_period_days, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning *
      `,
      [
        generateShortUuid(12),
        schoolId,
        data.academicYearId,
        data.classId,
        data.teacherId,
        data.firstPeriodSubjectId ?? null,
        toJsonbArray(data.firstPeriodDays),
        DEFAULTS.STATUS,
        userId,
        new Date(),
      ],
    );
    return results[0];
  }

  public async update(
    id: string,
    data: UpdateClassTeacherRequest,
    schoolId: string,
    userId: string,
  ): Promise<ClassTeacher | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    // Each field is optional and updated independently; omitted = unchanged.
    const teacherId =
      data.teacherId !== undefined ? data.teacherId : existing.teacherId;
    const firstPeriodSubjectId =
      data.firstPeriodSubjectId !== undefined
        ? data.firstPeriodSubjectId
        : (existing.firstPeriodSubjectId ?? null);
    const firstPeriodDays =
      data.firstPeriodDays !== undefined
        ? data.firstPeriodDays
        : (existing.firstPeriodDays ?? null);
    const results = await DB.query(
      singleLineString`
        update class_teacher
        set teacher_id = $1, first_period_subject_id = $2, first_period_days = $3, updatedby_userid = $4, updated_at = $5
        where uuid = $6 and school_id = $7 and status = 'active'
        returning *
      `,
      [
        teacherId,
        firstPeriodSubjectId,
        toJsonbArray(firstPeriodDays),
        userId,
        new Date(),
        id,
        schoolId,
      ],
    );
    return results.length > 0 ? results[0] : null;
  }

  public async delete(
    id: string,
    schoolId: string,
    userId: string,
  ): Promise<void> {
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
