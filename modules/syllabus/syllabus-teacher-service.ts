import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { DEFAULTS } from './syllabus-constants';
import { findClass, findEmployee } from './syllabus-common';
import { gradeEquals, normSubject, SUBJECT_ALIAS } from './syllabus-util';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class SyllabusTeacherService {
  // Teachers assigned to a plan, one row per (section, teacher), with names.
  public async listForPlan(syllabusId: string, schoolId: string): Promise<any[] | null> {
    const plan = await DB.query(
      singleLineString`select uuid from syllabus where uuid = $1 and school_id = $2 and status = 'active'`,
      [syllabusId, schoolId],
    );
    if (plan.length === 0) return null;
    return DB.query(
      singleLineString`
        select spt.uuid, spt.class_id, c.name as class_name, spt.teacher_id, e.name as teacher_name
        from syllabus_plan_teacher spt
        left join class c on c.uuid = spt.class_id
        left join employee e on e.uuid = spt.teacher_id
        where spt.syllabus_id = $1 and spt.school_id = $2 and spt.status = 'active'
        order by c.name, e.name
      `,
      [syllabusId, schoolId],
    );
  }

  // Assign a teacher to a section of a plan. Validates the section belongs to the
  // plan's grade and the teacher exists; idempotent on (plan, section, teacher).
  public async assign(
    syllabusId: string, data: { classId: string; teacherId: string }, schoolId: string, userId: string,
  ): Promise<any | null> {
    if (!data.classId || !data.teacherId) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'classId and teacherId are required');
    }
    const plan = await DB.query(
      singleLineString`select uuid, grade from syllabus where uuid = $1 and school_id = $2 and status = 'active'`,
      [syllabusId, schoolId],
    );
    if (plan.length === 0) return null;

    const cls = await findClass(schoolId, data.classId);
    if (!cls) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid classId');
    if (!gradeEquals(cls.name, plan[0].grade)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Section "${cls.name}" is not in grade ${plan[0].grade}`);
    }
    const teacher = await findEmployee(schoolId, data.teacherId);
    if (!teacher) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid teacherId');

    const existing = await DB.query(
      singleLineString`
        select uuid from syllabus_plan_teacher
        where syllabus_id = $1 and class_id = $2 and teacher_id = $3 and status = 'active'
      `,
      [syllabusId, data.classId, data.teacherId],
    );
    if (existing.length > 0) {
      return { uuid: existing[0].uuid, classId: data.classId, className: cls.name, teacherId: data.teacherId, teacherName: teacher.name };
    }
    const uuid = generateShortUuid(12);
    await DB.query(
      singleLineString`
        insert into syllabus_plan_teacher
        (uuid, school_id, syllabus_id, class_id, teacher_id, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [uuid, schoolId, syllabusId, data.classId, data.teacherId, DEFAULTS.STATUS, userId, new Date()],
    );
    return { uuid, classId: data.classId, className: cls.name, teacherId: data.teacherId, teacherName: teacher.name };
  }

  // All persisted teacher assignments for every plan in a (year, grade) scope, in
  // ONE query. Powers the Offerings matrix — the previous per-plan fetch was an
  // N+1 (one request per subject) whose intermittent failures got silently
  // swallowed, making saved teachers flicker/vanish. Rows carry syllabus_id so the
  // caller can group by plan. Stream is intentionally NOT filtered — the caller
  // groups by syllabus_id and ignores plans it isn't showing.
  public async listForScope(
    schoolId: string, academicYearId: string, grade: string,
  ): Promise<any[]> {
    return DB.query(
      singleLineString`
        select spt.uuid, spt.syllabus_id, spt.class_id, c.name as class_name,
               spt.teacher_id, e.name as teacher_name
        from syllabus_plan_teacher spt
        join syllabus s on s.uuid = spt.syllabus_id and s.status = 'active'
        left join class c on c.uuid = spt.class_id
        left join employee e on e.uuid = spt.teacher_id
        where spt.school_id = $1 and spt.status = 'active'
          and s.academic_year_id = $2 and lower(s.grade) = lower($3)
        order by c.name, e.name
      `,
      [schoolId, academicYearId, grade.trim()],
    );
  }

  // Live "resolve from the timetable": for each base section of the plan's grade,
  // the teacher who teaches the matching subject in teaching_assignment (matched by
  // normalised subject name + alias, since the timetable's subject catalogue is
  // separate). The Offerings screen shows these as suggestions to pin as overrides
  // (syllabus_plan_teacher). Sections with no timetable match are omitted.
  public async suggestForPlan(syllabusId: string, schoolId: string): Promise<any[] | null> {
    const plan = await DB.query(
      singleLineString`
        select s.uuid, s.grade, s.academic_year_id, sub.name as subject_name
        from syllabus s join syllabus_subject sub on sub.uuid = s.subject_id
        where s.uuid = $1 and s.school_id = $2 and s.status = 'active'
      `,
      [syllabusId, schoolId],
    );
    if (plan.length === 0) return null;
    const p = plan[0];

    const classes = await DB.query(
      singleLineString`select uuid, name from class where school_id = $1 and base_class_id is null and class_group_id is null`,
      [schoolId],
    );
    const sections = classes.filter((c: any) => gradeEquals(c.name, p.grade));
    if (sections.length === 0) return [];

    const key = SUBJECT_ALIAS[normSubject(p.subjectName)] || normSubject(p.subjectName);
    const secIds = sections.map((s: any) => s.uuid);
    const ta = await DB.query(
      singleLineString`
        select ta.class_id, s.name as subject_name, ta.teacher_id, e.name as teacher_name
        from teaching_assignment ta
        join subject s on s.uuid = ta.subject_id
        left join employee e on e.uuid = ta.teacher_id
        where ta.school_id = $1 and ta.academic_year_id = $2 and ta.status = 'active' and ta.class_id = any($3)
      `,
      [schoolId, p.academicYearId, secIds],
    );

    const out: any[] = [];
    for (const sec of sections) {
      const hit = ta.find((r: any) => r.classId === sec.uuid && normSubject(r.subjectName) === key);
      if (hit) {
        out.push({
          classId: sec.uuid,
          className: sec.name,
          teacherId: hit.teacherId,
          teacherName: hit.teacherName,
          matchedSubject: hit.subjectName,
        });
      }
    }
    return out;
  }

  public async unassign(assignmentId: string, schoolId: string, userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select uuid from syllabus_plan_teacher where uuid = $1 and school_id = $2 and status = 'active'`,
      [assignmentId, schoolId],
    );
    if (rows.length === 0) return false;
    await DB.query(
      singleLineString`
        update syllabus_plan_teacher set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), assignmentId, schoolId],
    );
    return true;
  }

  // The plans (per section) a teacher is assigned to, with per-section coverage
  // counts. Powers the teacher-PWA "My Syllabus" list.
  public async myPlans(schoolId: string, employeeId: string): Promise<any[]> {
    return DB.query(
      singleLineString`
        select spt.uuid as assignment_id, s.uuid as syllabus_id, s.grade, s.subject_id, s.layout,
               s.academic_year_id, sub.name as subject_name, spt.class_id, c.name as class_name,
               (select count(*) from syllabus_entry e
                  where e.syllabus_id = s.uuid and e.status = 'active'
                    and e.entry_type not in ('unit','section','exam','revision')
                    and not exists (select 1 from syllabus_entry c where c.parent_entry_id = e.uuid and c.status = 'active'))::int as total_topics,
               (select count(*) from syllabus_progress p
                  join syllabus_entry e on e.uuid = p.syllabus_entry_id
                  where e.syllabus_id = s.uuid and e.status = 'active'
                    and e.entry_type not in ('unit','section','exam','revision')
                    and not exists (select 1 from syllabus_entry c where c.parent_entry_id = e.uuid and c.status = 'active')
                    and p.class_id = spt.class_id and p.status = 'covered')::int as covered_topics
        from syllabus_plan_teacher spt
        join syllabus s on s.uuid = spt.syllabus_id and s.status = 'active'
        left join syllabus_subject sub on sub.uuid = s.subject_id
        left join class c on c.uuid = spt.class_id
        where spt.school_id = $1 and spt.teacher_id = $2 and spt.status = 'active'
        order by c.name, sub.name
      `,
      [schoolId, employeeId],
    );
  }
}

export const syllabusTeacherService = new SyllabusTeacherService();
