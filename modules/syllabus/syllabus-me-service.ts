import { DB, singleLineString } from "../../shared/lib/db";
import { MONTHS } from "./syllabus-constants";
import { findStudentClass } from "./syllabus-common";
import { currentMonth, parseGrade } from "./syllabus-util";

class SyllabusMeService {
  // The active child's grade timeline for a year: every subject plan for the
  // grade, its entries grouped into months (teaching order), each entry carrying
  // the child's section coverage. `currentMonth` anchors "we are here".
  public async getTimeline(
    schoolId: string,
    studentId: string,
    academicYearId: string,
    today?: string,
  ): Promise<any> {
    if (!academicYearId) {
      return { error: "academicYearId is required" };
    }
    const placement = await findStudentClass(
      schoolId,
      studentId,
      academicYearId,
    );
    const anchor = currentMonth(today);
    if (!placement) {
      return {
        academicYearId,
        grade: null,
        classId: null,
        className: null,
        currentMonth: anchor,
        subjects: [],
      };
    }
    const grade = parseGrade(placement.className);

    const plans = await DB.query(
      singleLineString`
        select s.uuid, s.subject_id, s.book, s.layout, s.note, sub.name as subject_name
        from syllabus s
        left join syllabus_subject sub on sub.uuid = s.subject_id
        where s.school_id = $1 and s.academic_year_id = $2 and lower(s.grade) = lower($3) and s.status = 'active'
        order by sub.name
      `,
      [schoolId, academicYearId, grade],
    );

    const subjects = [];
    for (const plan of plans) {
      const entries = await DB.query(
        singleLineString`
          select e.uuid, e.seq, e.month, e.entry_type, e.topic_no, e.title, e.theme, e.page_ref, e.term,
                 coalesce(p.status = 'covered', false) as covered, p.covered_date
          from syllabus_entry e
          left join syllabus_progress p on p.syllabus_entry_id = e.uuid and p.class_id = $2
          where e.syllabus_id = $1 and e.school_id = $3 and e.status = 'active'
          order by e.seq asc
        `,
        [plan.uuid, placement.classId, schoolId],
      );

      // Group entries by month, preserving teaching order (April→March).
      const months = MONTHS.map((m) => ({
        month: m.value,
        label: m.label,
        isCurrent: m.value === anchor,
        entries: entries.filter((e: any) => e.month === m.value),
      })).filter((g) => g.entries.length > 0);

      subjects.push({
        syllabusId: plan.uuid,
        subjectId: plan.subjectId,
        subjectName: plan.subjectName,
        layout: plan.layout,
        book: plan.book,
        note: plan.note,
        months,
      });
    }

    return {
      academicYearId,
      grade,
      classId: placement.classId,
      className: placement.className,
      currentMonth: anchor,
      subjects,
    };
  }
}

export const syllabusMeService = new SyllabusMeService();
