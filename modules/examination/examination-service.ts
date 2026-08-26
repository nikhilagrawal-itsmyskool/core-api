import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { gradeOf, isValidDate } from "./examination-common";
import {
  CreateExamRequest,
  Examination,
  ExamPaperCell,
  GridSection,
  GridView,
  InvigilatorView,
  UpdateExamRequest,
} from "./examination-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const EXAM_COLS = singleLineString`
  uuid, academic_year_id, name, status, incharge_employee_id,
  dues_threshold_current, dues_threshold_prior, cards_per_page,
  to_char(start_date, 'YYYY-MM-DD') as start_date,
  to_char(end_date, 'YYYY-MM-DD') as end_date
`;

const DEFAULT_CARDS_PER_PAGE = 4;
const EXAM_STATUSES = ["draft", "published", "archived"];

class ExaminationService {
  // ── Audit ────────────────────────────────────────────────────────────────────
  private async audit(
    schoolId: string,
    examId: string | null,
    entity: "exam" | "paper" | "invigilator",
    action: string,
    detail: string,
    userId: string,
  ): Promise<void> {
    await DB.query(
      singleLineString`
        insert into exam_audit
        (uuid, school_id, exam_id, entity, action, detail, changedby_userid, changed_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [generateShortUuid(12), schoolId, examId, entity, action, detail.slice(0, 512), userId, new Date()],
    );
  }

  // ── Examinations ───────────────────────────────────────────────────────────────
  async listExams(schoolId: string, academicYearId: string): Promise<Examination[]> {
    const rows = await DB.query(
      singleLineString`
        select ${EXAM_COLS},
          (select count(*) from exam_paper p where p.exam_id = e.uuid and p.status = 'active') as paper_count,
          (select emp.name from employee emp where emp.uuid = e.incharge_employee_id) as incharge_name
        from examination e
        where e.school_id = $1 and e.academic_year_id = $2 and e.status <> 'deleted'
        order by e.created_at desc nulls last, e.name
      `,
      [schoolId, academicYearId],
    );
    return rows.map((r: any) => ({ ...r, paperCount: Number(r.paperCount || 0) }));
  }

  async getExam(schoolId: string, examId: string): Promise<Examination | null> {
    const rows = await DB.query(
      singleLineString`
        select ${EXAM_COLS},
          (select count(*) from exam_paper p where p.exam_id = e.uuid and p.status = 'active') as paper_count,
          (select emp.name from employee emp where emp.uuid = e.incharge_employee_id) as incharge_name
        from examination e
        where e.school_id = $1 and e.uuid = $2 and e.status <> 'deleted'
      `,
      [schoolId, examId],
    );
    if (!rows.length) return null;
    return { ...rows[0], paperCount: Number(rows[0].paperCount || 0) };
  }

  // Internal: fetch the exam row (status/ay) or throw a 404-style business error.
  private async requireExam(schoolId: string, examId: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select uuid, academic_year_id, status from examination
        where school_id = $1 and uuid = $2 and status <> 'deleted'`,
      [schoolId, examId],
    );
    if (!rows.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "Examination not found");
    return rows[0];
  }

  async createExam(schoolId: string, academicYearId: string, req: CreateExamRequest, userId: string): Promise<Examination> {
    const name = (req.name || "").trim();
    if (!name) throw new BusinessErrorResult(ErrorCode.BusinessError, "name is required");
    const cardsPerPage = req.cardsPerPage === 3 ? 3 : DEFAULT_CARDS_PER_PAGE;
    const uuid = generateShortUuid(12);
    const now = new Date();
    await DB.query(
      singleLineString`
        insert into examination
        (uuid, school_id, academic_year_id, name, status, incharge_employee_id, cards_per_page, createdby_userid, created_at)
        values ($1, $2, $3, $4, 'draft', $5, $6, $7, $8)
      `,
      [uuid, schoolId, academicYearId, name, req.inchargeEmployeeId || null, cardsPerPage, userId, now],
    );
    await this.audit(schoolId, uuid, "exam", "create", `exam "${name}"`, userId);
    return (await this.getExam(schoolId, uuid))!;
  }

  async updateExam(
    schoolId: string,
    examId: string,
    req: UpdateExamRequest,
    userId: string,
    allowThresholds: boolean,
  ): Promise<Examination | null> {
    const exam = await this.requireExam(schoolId, examId);
    const sets: string[] = [];
    const params: any[] = [];
    const push = (frag: string, val: any) => { params.push(val); sets.push(`${frag} = $${params.length}`); };

    if (req.name !== undefined) {
      const name = (req.name || "").trim();
      if (!name) throw new BusinessErrorResult(ErrorCode.BusinessError, "name cannot be empty");
      push("name", name);
    }
    if (req.inchargeEmployeeId !== undefined) push("incharge_employee_id", req.inchargeEmployeeId || null);
    if (req.cardsPerPage !== undefined) {
      const n = req.cardsPerPage === 3 ? 3 : req.cardsPerPage === 4 ? 4 : null;
      if (n === null) throw new BusinessErrorResult(ErrorCode.BusinessError, "cardsPerPage must be 3 or 4");
      push("cards_per_page", n);
    }
    if (req.status !== undefined) {
      if (!EXAM_STATUSES.includes(req.status)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `status must be one of ${EXAM_STATUSES.join(", ")}`);
      }
      if (req.status === "published" && exam.status !== "published") {
        const papers = await DB.query(
          singleLineString`select 1 from exam_paper where exam_id = $1 and status = 'active' limit 1`,
          [examId],
        );
        if (!papers.length) {
          throw new BusinessErrorResult(ErrorCode.BusinessError, "Add at least one paper to the datesheet before publishing");
        }
      }
      push("status", req.status);
    }
    if (req.duesThresholdCurrent !== undefined || req.duesThresholdPrior !== undefined) {
      if (!allowThresholds) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a god user can change dues thresholds");
      }
      if (req.duesThresholdCurrent !== undefined) push("dues_threshold_current", req.duesThresholdCurrent);
      if (req.duesThresholdPrior !== undefined) push("dues_threshold_prior", req.duesThresholdPrior);
    }
    if (!sets.length) return this.getExam(schoolId, examId);

    push("updatedby_userid", userId);
    push("updated_at", new Date());
    params.push(schoolId, examId);
    await DB.query(
      singleLineString`update examination set ${sets.join(", ")}
        where school_id = $${params.length - 1} and uuid = $${params.length}`,
      params,
    );
    await this.audit(schoolId, examId, "exam", "update", `fields: ${sets.map((s) => s.split(" = ")[0]).join(", ")}`, userId);
    return this.getExam(schoolId, examId);
  }

  async deleteExam(schoolId: string, examId: string, userId: string): Promise<boolean> {
    const res = await DB.query(
      singleLineString`update examination set status = 'deleted', updatedby_userid = $3, updated_at = $4
        where school_id = $1 and uuid = $2 and status <> 'deleted' returning uuid`,
      [schoolId, examId, userId, new Date()],
    );
    if (!res.length) return false;
    await this.audit(schoolId, examId, "exam", "delete", "exam deleted", userId);
    return true;
  }

  // ── Sections / grades for the exam's academic year ───────────────────────────
  // Real, pickable classes (base_class_id null) that have active enrolment that year —
  // the same rule the class dropdown / class-strength use. Grade = name prefix.
  private async sectionsForExam(schoolId: string, academicYearId: string): Promise<GridSection[]> {
    const rows = await DB.query(
      singleLineString`
        select c.uuid as class_id, c.name, c.seq from class c
        where c.school_id = $1 and c.base_class_id is null and exists (
          select 1 from student_class sc
          join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status <> 'deleted'
          where sc.class_id = c.uuid and sc.school_id = c.school_id and sc.academic_year_id = $2
            and (sc.status is null or sc.status <> 'deleted')
        )
        order by c.seq asc nulls last, c.name
      `,
      [schoolId, academicYearId],
    );
    return rows.map((r: any, i: number) => ({
      classId: r.classId,
      name: r.name,
      grade: gradeOf(r.name),
      seq: r.seq != null ? Number(r.seq) : (i + 1) * 1000,
    }));
  }

  // Distinct grades (columns), ordered by the smallest section seq within each grade.
  private gradesFromSections(sections: GridSection[]): { grade: string; seq: number }[] {
    const bySeq = new Map<string, number>();
    for (const s of sections) {
      if (!s.grade) continue;
      const cur = bySeq.get(s.grade);
      if (cur === undefined || s.seq < cur) bySeq.set(s.grade, s.seq);
    }
    return [...bySeq.entries()]
      .map(([grade, seq]) => ({ grade, seq }))
      .sort((a, b) => a.seq - b.seq || a.grade.localeCompare(b.grade));
  }

  // ── Datesheet grid ───────────────────────────────────────────────────────────
  async getGrid(schoolId: string, examId: string): Promise<GridView> {
    const exam = await this.requireExam(schoolId, examId);
    const sections = await this.sectionsForExam(schoolId, exam.academicYearId);
    const grades = this.gradesFromSections(sections);
    const paperRows = await DB.query(
      singleLineString`
        select grade, to_char(exam_date, 'YYYY-MM-DD') as exam_date, subject_label
        from exam_paper where exam_id = $1 and status = 'active'
        order by exam_date, grade
      `,
      [examId],
    );
    const papers: ExamPaperCell[] = paperRows.map((r: any) => ({
      grade: r.grade, examDate: r.examDate, subjectLabel: r.subjectLabel,
    }));
    const dates = [...new Set(papers.map((p) => p.examDate))].sort();
    return { examId, status: exam.status, grades, dates, papers };
  }

  // Replace the full set of filled cells. Empty/whitespace subjects are dropped (a
  // blank cell just means "no paper"). One transaction: soft-delete then insert.
  async savePapers(schoolId: string, examId: string, cells: ExamPaperCell[], userId: string): Promise<GridView> {
    const exam = await this.requireExam(schoolId, examId);
    if (exam.status === "archived") throw new BusinessErrorResult(ErrorCode.BusinessError, "Cannot edit an archived exam");
    if (!Array.isArray(cells)) throw new BusinessErrorResult(ErrorCode.BusinessError, "papers must be an array");

    // Validate + dedupe (last write wins per grade+date).
    const seen = new Map<string, ExamPaperCell>();
    for (const c of cells) {
      const grade = (c.grade || "").trim();
      const subject = (c.subjectLabel || "").trim();
      if (!grade || !isValidDate(c.examDate) || !subject) continue;
      seen.set(`${grade}|${c.examDate}`, { grade, examDate: c.examDate, subjectLabel: subject.slice(0, 256) });
    }

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();
    queries.push(
      singleLineString`update exam_paper set status = 'deleted', updatedby_userid = $2, updated_at = $3
        where exam_id = $1 and status = 'active'`,
    );
    params.push([examId, userId, now]);
    for (const c of seen.values()) {
      queries.push(
        singleLineString`
          insert into exam_paper
          (uuid, school_id, exam_id, grade, exam_date, subject_label, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
        `,
      );
      params.push([generateShortUuid(12), schoolId, examId, c.grade, c.examDate, c.subjectLabel, userId, now]);
    }
    await DB.queriesInTransaction(queries, params);
    await this.audit(schoolId, examId, "paper", "save", `${seen.size} paper cell(s)`, userId);
    return this.getGrid(schoolId, examId);
  }

  // ── Invigilator assignment ─────────────────────────────────────────────────────
  async getInvigilators(schoolId: string, examId: string): Promise<InvigilatorView> {
    const exam = await this.requireExam(schoolId, examId);
    const sections = await this.sectionsForExam(schoolId, exam.academicYearId);

    const paperRows = await DB.query(
      singleLineString`select distinct grade, to_char(exam_date, 'YYYY-MM-DD') as exam_date
        from exam_paper where exam_id = $1 and status = 'active'`,
      [examId],
    );
    const gradesByDate: Record<string, string[]> = {};
    for (const r of paperRows) {
      (gradesByDate[r.examDate] ||= []).push(r.grade);
    }
    const dates = Object.keys(gradesByDate).sort();

    const assignRows = await DB.query(
      singleLineString`
        select to_char(i.exam_date, 'YYYY-MM-DD') as exam_date, i.section_class_id, i.employee_id,
          (select emp.name from employee emp where emp.uuid = i.employee_id) as employee_name
        from exam_invigilator i
        where i.exam_id = $1 and i.status = 'active'
      `,
      [examId],
    );
    const assignments = assignRows.map((r: any) => ({
      examDate: r.examDate,
      sectionClassId: r.sectionClassId,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
    }));

    // Conflicts: an employee assigned to >1 section on the same date (allowed, warned).
    const byDateEmp = new Map<string, Set<string>>();
    for (const a of assignments) {
      const key = `${a.examDate}|${a.employeeId}`;
      (byDateEmp.get(key) || byDateEmp.set(key, new Set()).get(key)!).add(a.sectionClassId);
    }
    const conflicts = [...byDateEmp.entries()]
      .filter(([, set]) => set.size > 1)
      .map(([key, set]) => {
        const [examDate, employeeId] = key.split("|");
        return { examDate, employeeId, sectionClassIds: [...set] };
      });

    return { examId, dates, sections, gradesByDate, assignments, conflicts };
  }

  async saveInvigilators(
    schoolId: string,
    examId: string,
    assignments: Array<{ examDate: string; sectionClassId: string; employeeId: string }>,
    userId: string,
  ): Promise<InvigilatorView> {
    const exam = await this.requireExam(schoolId, examId);
    if (exam.status === "archived") throw new BusinessErrorResult(ErrorCode.BusinessError, "Cannot edit an archived exam");
    if (!Array.isArray(assignments)) throw new BusinessErrorResult(ErrorCode.BusinessError, "assignments must be an array");

    const seen = new Map<string, { examDate: string; sectionClassId: string; employeeId: string }>();
    for (const a of assignments) {
      const employeeId = (a.employeeId || "").trim();
      const sectionClassId = (a.sectionClassId || "").trim();
      if (!isValidDate(a.examDate) || !sectionClassId || !employeeId) continue;
      seen.set(`${a.examDate}|${sectionClassId}`, { examDate: a.examDate, sectionClassId, employeeId });
    }

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();
    queries.push(
      singleLineString`update exam_invigilator set status = 'deleted', updatedby_userid = $2, updated_at = $3
        where exam_id = $1 and status = 'active'`,
    );
    params.push([examId, userId, now]);
    for (const a of seen.values()) {
      queries.push(
        singleLineString`
          insert into exam_invigilator
          (uuid, school_id, exam_id, exam_date, section_class_id, employee_id, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
        `,
      );
      params.push([generateShortUuid(12), schoolId, examId, a.examDate, a.sectionClassId, a.employeeId, userId, now]);
    }
    await DB.queriesInTransaction(queries, params);
    await this.audit(schoolId, examId, "invigilator", "save", `${seen.size} assignment(s)`, userId);
    return this.getInvigilators(schoolId, examId);
  }
}

export const examinationService = new ExaminationService();
