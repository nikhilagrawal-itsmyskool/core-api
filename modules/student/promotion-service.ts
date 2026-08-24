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
  MoveSectionOptions,
  MoveSectionRequest,
  MoveSectionResult,
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

  // ---- Section move (intra-year, single student) --------------------------
  // Move one student from their current section to another section of the SAME
  // grade in the SAME academic year. Unlike promote (which inserts a new row for
  // a new year), this is an in-place update of the current student_class row, so
  // there is still exactly one active enrolment per year and the current-class
  // resolver stays unambiguous everywhere (360, timetable, attendance).

  // The current (latest active) enrolment for a student, with class + year names.
  private async currentEnrollment(studentId: string, schoolId: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`
        select sc.uuid as enrollment_id, sc.class_id, c.name as class_name,
               sc.academic_year_id, ay.name as academic_year_name,
               sc.roll_number, sc.stream_code
        from student_class sc
        join academic_year ay on ay.uuid = sc.academic_year_id
        left join class c on c.uuid = sc.class_id
        where sc.student_id = $1 and sc.school_id = $2
          and (sc.status is null or sc.status <> 'deleted')
        order by ay.start_date desc nulls last
        limit 1
      `,
      [studentId, schoolId]
    );
    return rows[0] || null;
  }

  // Grade token = the class name up to the first '-' ("VI-B" -> "VI", "UKG" -> "UKG").
  private gradeOf(className: string): string {
    return String(className || '').split('-')[0].trim();
  }

  // Sibling sections of the same grade (real, pickable classes only) with their
  // active head-count and next free roll for the given year. Excludes the current
  // class, stream-child rows (base_class_id set) and timetable cohort classes.
  private async siblingSections(
    schoolId: string,
    grade: string,
    academicYearId: string,
    excludeClassId: string
  ): Promise<MoveSectionOptions['targets']> {
    return DB.query(
      singleLineString`
        select c.uuid as class_id, c.name as class_name,
               coalesce(cnt.n, 0)::int as headcount,
               (coalesce(cnt.max_roll, 0) + 1)::int as next_roll
        from class c
        left join lateral (
          select count(*) as n, max(sc.roll_number) as max_roll
          from student_class sc
          join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status <> 'deleted'
          where sc.class_id = c.uuid and sc.school_id = c.school_id
            and sc.academic_year_id = $3
            and (sc.status is null or sc.status <> 'deleted')
        ) cnt on true
        where c.school_id = $1
          and c.base_class_id is null
          and c.class_group_id is null
          and c.uuid <> $4
          and split_part(c.name, '-', 1) = $2
        order by c.seq asc nulls last, c.name
      `,
      [schoolId, grade, academicYearId, excludeClassId]
    );
  }

  public async moveOptions(studentId: string, schoolId: string): Promise<MoveSectionOptions> {
    const students = await DB.query(
      `select uuid, name from student where uuid = $1 and school_id = $2 and status = 'active'`,
      [studentId, schoolId]
    );
    if (students.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Unknown or inactive student');
    }
    const cur = await this.currentEnrollment(studentId, schoolId);
    if (!cur) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Student has no current enrolment to move');
    }
    const grade = this.gradeOf(cur.className);
    const targets = await this.siblingSections(schoolId, grade, cur.academicYearId, cur.classId);
    return {
      student: { uuid: students[0].uuid, name: students[0].name },
      current: {
        enrollmentId: cur.enrollmentId,
        classId: cur.classId,
        className: cur.className,
        academicYearId: cur.academicYearId,
        academicYearName: cur.academicYearName,
        rollNumber: cur.rollNumber ?? null,
      },
      targets,
    };
  }

  public async moveSection(
    req: MoveSectionRequest,
    schoolId: string,
    userId: string
  ): Promise<MoveSectionResult> {
    if (!req.studentId || !req.toClassId) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'studentId and toClassId are required');
    }

    const cur = await this.currentEnrollment(req.studentId, schoolId);
    if (!cur) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Student has no current enrolment to move');
    }
    if (cur.classId === req.toClassId) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Student is already in that section');
    }

    // Target must be a real, pickable section of the same grade in this school.
    const target = await DB.query(
      singleLineString`
        select uuid, name from class
        where uuid = $1 and school_id = $2 and base_class_id is null and class_group_id is null
      `,
      [req.toClassId, schoolId]
    );
    if (target.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid target section');
    }
    if (this.gradeOf(target[0].name) !== this.gradeOf(cur.className)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        'Target section is a different grade — use Promote for a grade change'
      );
    }

    // Guard against a stray duplicate enrolment in the target for this year (would
    // trip the (student, year, class) unique index and means they are half-moved).
    const dupe = await DB.query(
      singleLineString`
        select 1 from student_class
        where student_id = $1 and academic_year_id = $2 and class_id = $3 and school_id = $4
          and (status is null or status <> 'deleted')
        limit 1
      `,
      [req.studentId, cur.academicYearId, req.toClassId, schoolId]
    );
    if (dupe.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Student already has an enrolment in that section');
    }

    // Resolve the roll number in the target section.
    let roll: number | null;
    if (req.autoRoll) {
      const m = await DB.query(
        singleLineString`
          select coalesce(max(roll_number), 0) + 1 as next_roll from student_class
          where class_id = $1 and academic_year_id = $2 and school_id = $3
            and (status is null or status <> 'deleted')
        `,
        [req.toClassId, cur.academicYearId, schoolId]
      );
      roll = Number(m[0].nextRoll);
    } else {
      roll = req.rollNumber == null ? null : Number(req.rollNumber);
    }

    // In-place move: re-point the current enrolment row to the target section.
    try {
      const updated = await DB.query(
        singleLineString`
          update student_class
          set class_id = $1, roll_number = $2, updatedby_userid = $3, updated_at = $4
          where uuid = $5 and school_id = $6
          returning uuid
        `,
        [req.toClassId, roll, userId, new Date(), cur.enrollmentId, schoolId]
      );
      if (updated.length === 0) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'Enrolment changed while moving — please retry');
      }
    } catch (e: any) {
      if (e instanceof BusinessErrorResult) throw e;
      if (e && e.code === '23505') {
        throw new BusinessErrorResult(
          ErrorCode.BusinessError,
          roll == null
            ? 'Could not move the student — please retry'
            : `Roll number ${roll} is already taken in ${target[0].name}`
        );
      }
      throw e;
    }

    return {
      done: true,
      fromClassName: cur.className,
      toClassName: target[0].name,
      rollNumber: roll,
      academicYearName: cur.academicYearName,
    };
  }
}

export const promotionService = new PromotionService();
