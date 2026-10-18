import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { DB, singleLineString } from "../../shared/lib/db";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { guardActiveStudent } from "../auth/auth-utils";
import { resolveStudentEnrollment } from "../../shared/lib/student-context";
import { getCurrentAcademicYearId } from "./examination-common";
import { reportService } from "./report-service";

const TERM_LABEL: Record<number, string> = { 1: "Half-Yearly", 2: "Annual" };

// Grade prefix from a class name: "VI-A" → "VI", "LKG-A" → "LKG" (exam_paper is keyed by grade).
const gradeOf = (className: string | null | undefined) => (className || "").split(/[-\s]/)[0].trim();

// Parent-app exam surface for the active child (X-Student-Id). One route dispatched
// by ?view= (reportcard | datesheet) to stay under CloudFormation's 500-resource cap:
//   GET /examination/me/exams?view=reportcard — approved report cards (terms this year)
//   GET /examination/me/exams?view=datesheet  — published exam schedule + present/absent
class ExamMeHandler {
  // Reached via the reused route GET /me/report/cards/me/{view} (classId='me', term=view)
  // or a ?view= query. view = reportcard (default) | datesheet.
  public exams = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    const view = event.pathParameters?.term || event.queryStringParameters?.view;
    if (view === "datesheet") return this.datesheet(event, ctx, callback);
    return this.reportCard(event, ctx, callback);
  };

  public reportCard = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const schoolId = auth.token.school_id;
      const studentId = auth.activeStudentId;

      const enrol = await resolveStudentEnrollment(schoolId, studentId);
      const ayId = enrol?.academicYearId || (await getCurrentAcademicYearId(schoolId));
      const classId = enrol?.classId;
      const base = { className: enrol?.className ?? null, academicYear: enrol?.academicYearName ?? null };
      if (!ayId || !classId) return ResponseBuilder.ok({ ...base, terms: [] }, callback);

      const terms: any[] = [];
      for (const term of [1, 2]) {
        let data: any;
        try {
          data = await reportService.reportCards(schoolId, ayId, classId, term, "me", true);
        } catch {
          continue; // no scheme / nothing for this term
        }
        const card = (data.students || []).find((s: any) => s.studentId === studentId);
        if (!card || !card.approvedAt) continue; // parents see APPROVED cards only

        const pct: number | null = card.overall?.percentage ?? null;
        const overallGrade =
          pct == null ? null : (data.scheme.scholasticScale.find((g: any) => pct >= g.minPct && pct <= g.maxPct)?.grade ?? null);

        terms.push({
          term,
          termLabel: TERM_LABEL[term] || `Term ${term}`,
          className: data.className,
          academicYear: data.academicYear,
          subjects: (data.scheme.subjects || []).map((su: any) => {
            const t = card.subjectTotals?.[su.code] || {};
            return { name: su.label, total: t.total ?? null, max: t.max ?? null, grade: t.grade ?? null };
          }),
          overall: { total: card.overall?.total ?? null, max: card.overall?.max ?? null, percentage: pct, grade: overallGrade },
          areas: (data.scheme.areas || []).map((a: any) => ({ label: a.label, section: a.section, grade: card.areaGrades?.[a.id] ?? null })),
          attendancePresent: card.attendancePresent ?? null,
          attendanceTotal: card.attendanceTotal ?? null,
          remark: card.remark ?? null,
          promotedTo: card.promotedTo ?? null,
          approvedAt: card.approvedAt ?? null,
          approvedBy: card.approvedBy ?? null,
        });
      }
      ResponseBuilder.ok({ ...base, terms }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public datesheet = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const schoolId = auth.token.school_id;
      const studentId = auth.activeStudentId;

      const enrol = await resolveStudentEnrollment(schoolId, studentId);
      const ayId = enrol?.academicYearId || (await getCurrentAcademicYearId(schoolId));
      const grade = gradeOf(enrol?.className);
      const base = { className: enrol?.className ?? null, grade: grade || null };
      if (!ayId || !grade) return ResponseBuilder.ok({ ...base, exams: [] }, callback);

      const exams = await DB.query(
        singleLineString`select uuid, name, to_char(start_date,'YYYY-MM-DD') as start_date, to_char(end_date,'YYYY-MM-DD') as end_date
          from examination where school_id = $1 and academic_year_id = $2 and status = 'published'
          order by start_date asc nulls last, created_at asc`,
        [schoolId, ayId],
      );
      if (!exams.length) return ResponseBuilder.ok({ ...base, exams: [] }, callback);

      const examIds = exams.map((e: any) => e.uuid);
      const papers = await DB.query(
        singleLineString`select uuid, exam_id, to_char(exam_date,'YYYY-MM-DD') as exam_date, subject_label
          from exam_paper where school_id = $1 and exam_id = any($2) and grade = $3 and status = 'active'
          order by exam_date asc, subject_label asc`,
        [schoolId, examIds, grade],
      );
      const paperIds = papers.map((p: any) => p.uuid);
      const att = paperIds.length
        ? await DB.query(
            singleLineString`select exam_paper_id, status from exam_attendance where school_id = $1 and student_id = $2 and exam_paper_id = any($3)`,
            [schoolId, studentId, paperIds],
          )
        : [];
      const attMap: Record<string, string> = {};
      att.forEach((a: any) => (attMap[a.examPaperId] = a.status));

      const byExam: Record<string, any[]> = {};
      papers.forEach((p: any) => {
        (byExam[p.examId] ||= []).push({ subject: p.subjectLabel, date: p.examDate, attendance: attMap[p.uuid] ?? null });
      });

      const out = exams
        .map((e: any) => ({ examId: e.uuid, name: e.name, startDate: e.startDate, endDate: e.endDate, papers: byExam[e.uuid] || [] }))
        .filter((e: any) => e.papers.length);

      ResponseBuilder.ok({ ...base, exams: out }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ExamMeHandler();
export const exams = handler.exams;
