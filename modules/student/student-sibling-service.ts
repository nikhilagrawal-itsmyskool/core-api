import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { SiblingRef } from './student-interfaces';
import { DEFAULTS } from './student-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Explicit sibling links between enrolled students. Links are written in both
// directions so reads are a single-direction query; unlink soft-deletes both.
class StudentSiblingService {
  public async list(studentId: string, schoolId: string): Promise<SiblingRef[]> {
    return DB.query(
      singleLineString`
        select ss.uuid, ss.sibling_student_id,
               s.admission_number, s.name,
               cur.class_name
        from student_sibling ss
        join student s on s.uuid = ss.sibling_student_id and s.school_id = ss.school_id
        left join lateral (
          select c.name as class_name
          from student_class sc
          join academic_year ay on sc.academic_year_id = ay.uuid
          left join class c on sc.class_id = c.uuid
          where sc.student_id = s.uuid and (sc.status is null or sc.status <> 'deleted')
          order by ay.start_date desc nulls last limit 1
        ) cur on true
        where ss.student_id = $1 and ss.school_id = $2 and ss.status = 'active'
          and s.status <> 'deleted'
        order by s.name
      `,
      [studentId, schoolId]
    );
  }

  private async pairExists(studentId: string, siblingStudentId: string, schoolId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`
        select 1 from student_sibling
        where school_id = $1 and student_id = $2 and sibling_student_id = $3 and status = 'active' limit 1
      `,
      [schoolId, studentId, siblingStudentId]
    );
    return rows.length > 0;
  }

  private async insertOne(studentId: string, siblingStudentId: string, schoolId: string, userId: string, now: Date): Promise<void> {
    if (await this.pairExists(studentId, siblingStudentId, schoolId)) return;
    await DB.query(
      singleLineString`
        insert into student_sibling
        (uuid, school_id, student_id, sibling_student_id, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [generateShortUuid(12), schoolId, studentId, siblingStudentId, DEFAULTS.STATUS, userId, now]
    );
  }

  public async link(studentId: string, siblingStudentId: string, schoolId: string, userId: string): Promise<SiblingRef[]> {
    if (!siblingStudentId || siblingStudentId === studentId) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'A valid, different sibling student is required');
    }
    const rows = await DB.query(
      `select 1 from student where uuid = $1 and school_id = $2 and status <> 'deleted' limit 1`,
      [siblingStudentId, schoolId]
    );
    if (rows.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Sibling student not found');
    }
    const now = new Date();
    await this.insertOne(studentId, siblingStudentId, schoolId, userId, now);
    await this.insertOne(siblingStudentId, studentId, schoolId, userId, now);
    return this.list(studentId, schoolId);
  }

  public async unlink(studentId: string, siblingStudentId: string, schoolId: string, userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`
        update student_sibling set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where school_id = $3 and status = 'active'
          and ((student_id = $4 and sibling_student_id = $5) or (student_id = $5 and sibling_student_id = $4))
        returning uuid
      `,
      [userId, new Date(), schoolId, studentId, siblingStudentId]
    );
    return rows.length > 0;
  }
}

export const studentSiblingService = new StudentSiblingService();
