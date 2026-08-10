import { DB, singleLineString } from '../../shared/lib/db';
import { listBaseClasses } from './syllabus-common';
import { parseGrade, currentMonth, monthOrder } from './syllabus-util';
import { MONTH_VALUES } from './syllabus-constants';

// Readiness board for the Syllabus Overview screen. One row per plan (year+grade
// +subject) with: content rollup, model-paper matrix (exam × doc-type + answer-key
// released), the plan's monthly-scheduled leaf counts (for plan-weighted "expected
// by now"), and per-section coverage + assigned teachers (so the client can draw a
// timeline per section and filter by teacher). Built from a handful of set-based
// queries merged in JS — never one request per plan (the Offerings N+1).
class SyllabusOverviewService {
  public async getOverview(schoolId: string, academicYearId: string, grade?: string): Promise<any> {
    const scope: any[] = [schoolId, academicYearId];
    let gflt = '';
    if (grade) { scope.push(grade.trim()); gflt = ` and lower(s.grade) = lower($${scope.length})`; }
    const currentMonthIndex = monthOrder(currentMonth());

    // 1. Plans + content rollup.
    const plans = await DB.query(
      singleLineString`
        select s.uuid as syllabus_id, s.grade, s.subject_id, sub.name as subject_name,
               (s.source_file_id is not null) as has_source,
               (select count(*) from syllabus_entry e where e.syllabus_id = s.uuid and e.status = 'active')::int as total_entries,
               (select count(*) from syllabus_entry e where e.syllabus_id = s.uuid and e.status = 'active' and e.entry_type not in ('unit','section','exam','revision') and not exists (select 1 from syllabus_entry c where c.parent_entry_id = e.uuid and c.status = 'active'))::int as content_leaves
        from syllabus s
        join syllabus_subject sub on sub.uuid = s.subject_id
        where s.school_id = $1 and s.academic_year_id = $2 and s.status = 'active'${gflt}
        order by s.grade, sub.name
      `,
      scope,
    );
    if (plans.length === 0) return { currentMonthIndex, rows: [] };

    // 2. Content leaves per plan per academic month (schedule for expected-by-now).
    const sched = await DB.query(
      singleLineString`
        select e.syllabus_id, e.month, count(*)::int as n
        from syllabus_entry e join syllabus s on s.uuid = e.syllabus_id
        where s.school_id = $1 and s.academic_year_id = $2 and s.status = 'active'${gflt}
          and e.status = 'active' and e.entry_type not in ('unit','section','exam','revision')
          and not exists (select 1 from syllabus_entry c where c.parent_entry_id = e.uuid and c.status = 'active')
        group by e.syllabus_id, e.month
      `,
      scope,
    );
    const schedByPlan = new Map<string, number[]>();
    for (const r of sched) {
      if (!schedByPlan.has(r.syllabusId)) schedByPlan.set(r.syllabusId, new Array(MONTH_VALUES.length).fill(0));
      const idx = MONTH_VALUES.indexOf(r.month);
      if (idx >= 0) schedByPlan.get(r.syllabusId)![idx] += r.n;
    }

    // 3. Covered leaves per plan per section.
    const cov = await DB.query(
      singleLineString`
        select e.syllabus_id, p.class_id, count(*)::int as n
        from syllabus_progress p
        join syllabus_entry e on e.uuid = p.syllabus_entry_id
        join syllabus s on s.uuid = e.syllabus_id
        where s.school_id = $1 and s.academic_year_id = $2 and s.status = 'active'${gflt}
          and e.status = 'active' and e.entry_type not in ('unit','section','exam','revision')
          and not exists (select 1 from syllabus_entry c where c.parent_entry_id = e.uuid and c.status = 'active')
          and p.status = 'covered'
        group by e.syllabus_id, p.class_id
      `,
      scope,
    );
    const covByPlanSec = new Map<string, number>();
    for (const r of cov) covByPlanSec.set(`${r.syllabusId}|${r.classId}`, r.n);

    // 4. Teachers per plan per section.
    const tchr = await DB.query(
      singleLineString`
        select spt.syllabus_id, spt.class_id, spt.teacher_id, emp.name as teacher_name
        from syllabus_plan_teacher spt
        join syllabus s on s.uuid = spt.syllabus_id
        left join employee emp on emp.uuid = spt.teacher_id
        where s.school_id = $1 and s.academic_year_id = $2 and s.status = 'active'${gflt} and spt.status = 'active'
      `,
      scope,
    );
    const tchrByPlanSec = new Map<string, { teacherId: string; teacherName: string }[]>();
    for (const r of tchr) {
      const k = `${r.syllabusId}|${r.classId}`;
      if (!tchrByPlanSec.has(k)) tchrByPlanSec.set(k, []);
      tchrByPlanSec.get(k)!.push({ teacherId: r.teacherId, teacherName: r.teacherName || r.teacherId });
    }

    // 5. Base sections per grade.
    const baseClasses = await listBaseClasses(schoolId);
    const sectionsByGrade = new Map<string, { classId: string; className: string }[]>();
    for (const c of baseClasses) {
      const g = parseGrade(c.name).toLowerCase();
      if (!sectionsByGrade.has(g)) sectionsByGrade.set(g, []);
      sectionsByGrade.get(g)!.push({ classId: c.uuid, className: c.name });
    }

    // 6. Model papers (exam × doc-type matrix + answer-key released) per grade+subject.
    const pScope: any[] = [schoolId, academicYearId];
    let pg = '';
    if (grade) { pScope.push(grade.trim()); pg = ` and lower(mp.grade) = lower($${pScope.length})`; }
    const paperRows = await DB.query(
      singleLineString`
        select mp.grade, mp.subject_id, mp.exam, mp.answer_key_released,
               bool_or(d.doc_type = 'model_paper') as has_paper,
               bool_or(d.doc_type = 'blueprint') as has_blueprint,
               bool_or(d.doc_type = 'answer_key') as has_key
        from syllabus_model_paper mp
        left join syllabus_model_paper_doc d on d.model_paper_id = mp.uuid and d.status = 'active'
        where mp.school_id = $1 and mp.academic_year_id = $2 and mp.status = 'active'${pg}
        group by mp.grade, mp.subject_id, mp.exam, mp.answer_key_released
      `,
      pScope,
    );
    const papersByPlan = new Map<string, any[]>();
    for (const r of paperRows) {
      const k = `${(r.grade || '').toLowerCase()}|${r.subjectId}`;
      if (!papersByPlan.has(k)) papersByPlan.set(k, []);
      papersByPlan.get(k)!.push({
        exam: r.exam,
        answerKeyReleased: r.answerKeyReleased,
        hasPaper: !!r.hasPaper,
        hasBlueprint: !!r.hasBlueprint,
        hasKey: !!r.hasKey,
      });
    }

    const rows = plans.map((p: any) => {
      const g = (p.grade || '').toLowerCase();
      const secs = sectionsByGrade.get(g) || [];
      const sections = secs.map((sec) => ({
        classId: sec.classId,
        className: sec.className,
        coveredCount: covByPlanSec.get(`${p.syllabusId}|${sec.classId}`) || 0,
        teachers: tchrByPlanSec.get(`${p.syllabusId}|${sec.classId}`) || [],
      }));
      return {
        syllabusId: p.syllabusId,
        grade: p.grade,
        subjectId: p.subjectId,
        subjectName: p.subjectName,
        hasContent: p.totalEntries > 0,
        contentLeaves: p.contentLeaves,
        hasSource: p.hasSource,
        papers: papersByPlan.get(`${g}|${p.subjectId}`) || [],
        monthlyScheduled: schedByPlan.get(p.syllabusId) || new Array(MONTH_VALUES.length).fill(0),
        sectionsTotal: sections.length,
        sectionsStaffed: sections.filter((s) => s.teachers.length > 0).length,
        sections,
      };
    });

    return { currentMonthIndex, rows };
  }
}

export const syllabusOverviewService = new SyllabusOverviewService();
