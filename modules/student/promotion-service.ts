import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  PromoteRequest,
  PromoteClassRequest,
  GraduateRequest,
  PromoteItem,
  PromotionResult,
  PromotionResultRow,
} from './student-interfaces';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class PromotionService {
  private async academicYearExists(id: string, schoolId: string): Promise<boolean> {
    const rows = await DB.query(
      `select 1 from academic_year where uuid = $1 and school_id = $2 limit 1`,
      [id, schoolId]
    );
    return rows.length > 0;
  }

  private async validStudentIds(ids: string[], schoolId: string): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await DB.query(
      `select uuid from student where school_id = $1 and status = 'active' and uuid = any($2)`,
      [schoolId, ids]
    );
    return new Set(rows.map((r: any) => r.uuid));
  }

  private async validClassIds(ids: string[], schoolId: string): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await DB.query(
      `select uuid from class where school_id = $1 and uuid = any($2)`,
      [schoolId, ids]
    );
    return new Set(rows.map((r: any) => r.uuid));
  }

  // Insert a new student_class row per item, in one transaction. Idempotent via the
  // existing (student_id, academic_year_id, class_id, school_id) unique index:
  // a row already present is reported as `skipped`, not duplicated.
  private async enroll(
    items: PromoteItem[],
    academicYearToId: string,
    schoolId: string,
    userId: string,
    preInvalid: PromotionResultRow[]
  ): Promise<PromotionResult> {
    const results: PromotionResultRow[] = [...preInvalid];

    if (items.length === 0) {
      return { done: 0, skipped: results.length, results };
    }

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    for (const it of items) {
      queries.push(singleLineString`
        insert into student_class
        (uuid, student_id, academic_year_id, class_id, roll_number, status, school_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
        on conflict (student_id, academic_year_id, class_id, school_id) do nothing
        returning uuid
      `);
      params.push([
        generateShortUuid(12),
        it.studentId,
        academicYearToId,
        it.toClassId,
        it.rollNumber ?? null,
        schoolId,
        userId,
        now,
      ]);
    }

    const queryResults = await DB.queriesInTransaction(queries, params);

    let done = 0;
    items.forEach((it, i) => {
      const inserted = Array.isArray(queryResults[i]) && queryResults[i].length > 0;
      if (inserted) {
        done++;
        results.push({ studentId: it.studentId, outcome: 'done' });
      } else {
        results.push({ studentId: it.studentId, outcome: 'skipped', reason: 'already enrolled in target class/year' });
      }
    });

    return { done, skipped: results.length - done, results };
  }

  // Validate items against school ownership; split into valid + pre-rejected.
  private async splitValidItems(
    items: PromoteItem[],
    schoolId: string
  ): Promise<{ valid: PromoteItem[]; invalid: PromotionResultRow[] }> {
    const validStudents = await this.validStudentIds(items.map((i) => i.studentId), schoolId);
    const validClasses = await this.validClassIds(items.map((i) => i.toClassId), schoolId);

    const valid: PromoteItem[] = [];
    const invalid: PromotionResultRow[] = [];
    for (const it of items) {
      if (!validStudents.has(it.studentId)) {
        invalid.push({ studentId: it.studentId, outcome: 'skipped', reason: 'unknown or inactive student' });
      } else if (!validClasses.has(it.toClassId)) {
        invalid.push({ studentId: it.studentId, outcome: 'skipped', reason: 'invalid target class' });
      } else {
        valid.push(it);
      }
    }
    return { valid, invalid };
  }

  // Promote / Retain — same mechanism. Retain is just toClassId === current class.
  public async promote(req: PromoteRequest, schoolId: string, userId: string): Promise<PromotionResult> {
    if (!req.academicYearToId || !Array.isArray(req.items)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'academicYearToId and items are required');
    }
    if (!(await this.academicYearExists(req.academicYearToId, schoolId))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid target academic year');
    }
    const { valid, invalid } = await this.splitValidItems(req.items, schoolId);
    return this.enroll(valid, req.academicYearToId, schoolId, userId, invalid);
  }

  // Promote a whole class: every active student enrolled in (fromClassId, academicYearFromId),
  // minus excludeStudentIds, carried into toClassId for academicYearToId (roll number preserved).
  public async promoteClass(req: PromoteClassRequest, schoolId: string, userId: string): Promise<PromotionResult> {
    if (!req.fromClassId || !req.academicYearFromId || !req.toClassId || !req.academicYearToId) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        'fromClassId, academicYearFromId, toClassId and academicYearToId are required'
      );
    }
    if (!(await this.academicYearExists(req.academicYearToId, schoolId))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid target academic year');
    }

    const source = await DB.query(
      singleLineString`
        select sc.student_id, sc.roll_number
        from student_class sc
        join student s on s.uuid = sc.student_id and s.school_id = sc.school_id
        where sc.school_id = $1 and sc.class_id = $2 and sc.academic_year_id = $3
          and (sc.status is null or sc.status <> 'deleted')
          and s.status = 'active'
      `,
      [schoolId, req.fromClassId, req.academicYearFromId]
    );

    const exclude = new Set(req.excludeStudentIds || []);
    // DB.query returns camelCase (transformKeys), so use r.studentId here.
    // Roll numbers are NOT carried forward in bulk: the target class for the new
    // year may already hold those numbers, and the partial unique index would abort
    // the whole batch. Roll numbers are assigned afterwards (or per-student via /promote).
    const items: PromoteItem[] = source
      .filter((r: any) => !exclude.has(r.studentId))
      .map((r: any) => ({ studentId: r.studentId, toClassId: req.toClassId }));

    const { valid, invalid } = await this.splitValidItems(items, schoolId);
    return this.enroll(valid, req.academicYearToId, schoolId, userId, invalid);
  }

  // Graduate / pass out: no new enrollment; flip student.status to 'inactive'.
  public async graduate(req: GraduateRequest, schoolId: string, userId: string): Promise<PromotionResult> {
    if (!Array.isArray(req.studentIds) || req.studentIds.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'studentIds are required');
    }

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    for (const studentId of req.studentIds) {
      queries.push(singleLineString`
        update student set status = 'inactive', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
        returning uuid
      `);
      params.push([userId, now, studentId, schoolId]);
    }

    const queryResults = await DB.queriesInTransaction(queries, params);

    const results: PromotionResultRow[] = [];
    let done = 0;
    req.studentIds.forEach((studentId, i) => {
      const updated = Array.isArray(queryResults[i]) && queryResults[i].length > 0;
      if (updated) {
        done++;
        results.push({ studentId, outcome: 'done' });
      } else {
        results.push({ studentId, outcome: 'skipped', reason: 'unknown student or not active' });
      }
    });

    return { done, skipped: results.length - done, results };
  }
}

export const promotionService = new PromotionService();
