import { DB, singleLineString } from '../../shared/lib/db';
import { listBaseClasses } from './syllabus-common';
import { parseGrade } from './syllabus-util';

// Readiness board for the Syllabus Overview screen: one row per plan (year+grade
// +subject) with content / teacher-staffing / model-paper / coverage rollups.
// Built as a few set-based queries merged in JS — deliberately NOT one request
// per plan (the Offerings N+1 that made data flicker).
class SyllabusOverviewService {
  public async getOverview(schoolId: string, academicYearId: string, grade?: string): Promise<any[]> {
    const params: any[] = [schoolId, academicYearId];
    let gradeFilter = '';
    if (grade) { params.push(grade.trim()); gradeFilter = ` and lower(s.grade) = lower($${params.length})`; }

    const plans = await DB.query(
      singleLineString`
        select s.uuid as syllabus_id, s.grade, s.subject_id, sub.name as subject_name,
               (s.source_file_id is not null) as has_source,
               (select count(*) from syllabus_entry e where e.syllabus_id = s.uuid and e.status = 'active')::int as total_entries,
               (select count(*) from syllabus_entry e where e.syllabus_id = s.uuid and e.status = 'active' and e.entry_type in ('topic','item'))::int as content_leaves,
               (select count(distinct spt.class_id) from syllabus_plan_teacher spt where spt.syllabus_id = s.uuid and spt.status = 'active')::int as sections_staffed,
               (select count(*) from syllabus_progress p join syllabus_entry e on e.uuid = p.syllabus_entry_id
                  where e.syllabus_id = s.uuid and e.status = 'active' and e.entry_type in ('topic','item') and p.status = 'covered')::int as covered_marks
        from syllabus s
        join syllabus_subject sub on sub.uuid = s.subject_id
        where s.school_id = $1 and s.academic_year_id = $2 and s.status = 'active'${gradeFilter}
        order by s.grade, sub.name
      `,
      params,
    );

    const paperParams: any[] = [schoolId, academicYearId];
    let paperGrade = '';
    if (grade) { paperParams.push(grade.trim()); paperGrade = ` and lower(grade) = lower($${paperParams.length})`; }
    const paperRows = await DB.query(
      singleLineString`
        select grade, subject_id, exam, answer_key_released
        from syllabus_model_paper
        where school_id = $1 and academic_year_id = $2 and status = 'active'${paperGrade}
      `,
      paperParams,
    );
    const papersByPlan = new Map<string, any[]>();
    for (const r of paperRows) {
      const key = `${(r.grade || '').toLowerCase()}|${r.subjectId}`;
      if (!papersByPlan.has(key)) papersByPlan.set(key, []);
      papersByPlan.get(key)!.push({ exam: r.exam, answerKeyReleased: r.answerKeyReleased });
    }

    // Base sections per grade (same source Offerings/teachers use).
    const baseClasses = await listBaseClasses(schoolId);
    const sectionsByGrade = new Map<string, number>();
    for (const c of baseClasses) {
      const g = parseGrade(c.name).toLowerCase();
      sectionsByGrade.set(g, (sectionsByGrade.get(g) || 0) + 1);
    }

    return plans.map((p: any) => {
      const g = (p.grade || '').toLowerCase();
      const sectionsTotal = sectionsByGrade.get(g) || 0;
      const coverageTotal = p.contentLeaves * sectionsTotal; // leaves × sections
      return {
        syllabusId: p.syllabusId,
        grade: p.grade,
        subjectId: p.subjectId,
        subjectName: p.subjectName,
        hasContent: p.totalEntries > 0,
        contentLeaves: p.contentLeaves,
        hasSource: p.hasSource,
        sectionsTotal,
        sectionsStaffed: p.sectionsStaffed,
        papers: papersByPlan.get(`${g}|${p.subjectId}`) || [],
        coveredMarks: p.coveredMarks,
        coverageTotal,
        coveragePct: coverageTotal > 0 ? Math.round((p.coveredMarks / coverageTotal) * 100) : null,
      };
    });
  }
}

export const syllabusOverviewService = new SyllabusOverviewService();
