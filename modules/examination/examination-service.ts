import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { feesLedgerService } from "../fees/fees-ledger-service";
import { fileStorageService } from "../../shared/lib/file-storage";
import { gradeOf, isValidDate } from "./examination-common";
const QRCode = require("qrcode");
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
  dues_threshold_current, dues_threshold_prior, cards_per_page, grades,
  has_invigilation, has_admit_cards,
  to_char(dues_cutoff_date, 'YYYY-MM-DD') as dues_cutoff_date,
  to_char(start_date, 'YYYY-MM-DD') as start_date,
  to_char(end_date, 'YYYY-MM-DD') as end_date
`;

// null flag = feature ON (so existing exams keep invigilation + admit cards).
const flagOn = (v: any): boolean => v !== false;

// grades stored as a comma-separated string; expose as an array (null = all available).
function parseGrades(csv: any): string[] | null {
  if (!csv) return null;
  const arr = String(csv).split(",").map((g) => g.trim()).filter(Boolean);
  return arr.length ? arr : null;
}

const DEFAULT_CARDS_PER_PAGE = 4;
const EXAM_STATUSES = ["draft", "published", "archived"];

class ExaminationService {
  // ── Audit ────────────────────────────────────────────────────────────────────
  private async audit(
    schoolId: string,
    examId: string | null,
    entity: "exam" | "paper" | "invigilator" | "override" | "print",
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
    return rows.map((r: any) => ({
      ...r, grades: parseGrades(r.grades), paperCount: Number(r.paperCount || 0),
      hasInvigilation: flagOn(r.hasInvigilation), hasAdmitCards: flagOn(r.hasAdmitCards),
    }));
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
    return {
      ...rows[0], grades: parseGrades(rows[0].grades), paperCount: Number(rows[0].paperCount || 0),
      hasInvigilation: flagOn(rows[0].hasInvigilation), hasAdmitCards: flagOn(rows[0].hasAdmitCards),
    };
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
    const hasInvigilation = req.hasInvigilation !== false;
    const hasAdmitCards = req.hasAdmitCards !== false;
    const uuid = generateShortUuid(12);
    const now = new Date();
    await DB.query(
      singleLineString`
        insert into examination
        (uuid, school_id, academic_year_id, name, status, incharge_employee_id, cards_per_page, has_invigilation, has_admit_cards, createdby_userid, created_at)
        values ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10)
      `,
      [uuid, schoolId, academicYearId, name, req.inchargeEmployeeId || null, cardsPerPage, hasInvigilation, hasAdmitCards, userId, now],
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
    if (req.grades !== undefined) {
      const csv = Array.isArray(req.grades) && req.grades.length
        ? [...new Set(req.grades.map((g) => String(g).trim()).filter(Boolean))].join(",")
        : null;
      push("grades", csv);
    }
    if (req.duesCutoffDate !== undefined) {
      const d = req.duesCutoffDate;
      if (d !== null && !isValidDate(d)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, "duesCutoffDate must be YYYY-MM-DD or null");
      }
      push("dues_cutoff_date", d || null);
    }
    if (req.hasInvigilation !== undefined) push("has_invigilation", !!req.hasInvigilation);
    if (req.hasAdmitCards !== undefined) push("has_admit_cards", !!req.hasAdmitCards);
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
    const exam = await this.getExam(schoolId, examId);
    if (!exam) throw new BusinessErrorResult(ErrorCode.BusinessError, "Examination not found");
    const sections = await this.sectionsForExam(schoolId, exam.academicYearId!);
    const availableGrades = this.gradesFromSections(sections);
    // Columns actually shown = the exam's chosen grades (default = all available).
    const grades = exam.grades && exam.grades.length
      ? availableGrades.filter((g) => exam.grades!.includes(g.grade))
      : availableGrades;
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
    return { examId, status: exam.status, grades, availableGrades, dates, papers };
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
    const exam = await this.getExam(schoolId, examId);
    if (!exam) throw new BusinessErrorResult(ErrorCode.BusinessError, "Examination not found");
    let sections = await this.sectionsForExam(schoolId, exam.academicYearId!);
    // Only sections whose grade is part of this exam (default = all available).
    if (exam.grades && exam.grades.length) {
      const set = new Set(exam.grades);
      sections = sections.filter((s) => set.has(s.grade));
    }

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

  // ════ Phase 2: dues gate, admit cards, printing, branding ═══════════════════════

  private async classInfo(schoolId: string, classId: string): Promise<{ classId: string; name: string; grade: string } | null> {
    const rows = await DB.query(
      singleLineString`select uuid, name from class where school_id = $1 and uuid = $2`,
      [schoolId, classId],
    );
    if (!rows.length) return null;
    return { classId, name: rows[0].name, grade: gradeOf(rows[0].name) };
  }

  // Active on-roll students of a section for the exam's year, alphabetical by name.
  private async sectionStudents(schoolId: string, academicYearId: string, classId: string): Promise<any[]> {
    return DB.query(
      singleLineString`
        select st.uuid as student_id, st.name, st.admission_number
        from student st
        join student_class sc on sc.student_id = st.uuid and sc.school_id = st.school_id
        where sc.class_id = $1 and sc.academic_year_id = $2 and st.school_id = $3 and st.status = 'active'
          and (sc.status is null or sc.status <> 'deleted')
        order by st.name
      `,
      [classId, academicYearId, schoolId],
    );
  }

  // Dues for the admit-card gate — the exam module's own policy, built on the fees
  // ledger's existing public API (no fees code is modified). Deliberately NOT the
  // full-year balance:
  //   currentDue = academic amount DUE BY NOW in the exam's year — the fees ledger's
  //                `bucket === 'due'` (arrears through the end of the current month), so
  //                not-yet-due future cycles (e.g. Oct–Mar tuition) don't block a
  //                paid-up student.
  //   priorDue   = academic outstanding across every OTHER year (prior years are fully
  //                past due, so their whole balance counts).
  // Transport is excluded from both (the school gates on tuition/academic dues only).
  private async examDues(
    schoolId: string,
    studentId: string,
    academicYearId: string,
    cutoffDate?: string | null,
  ): Promise<{ currentDue: number; priorDue: number }> {
    const led = await feesLedgerService.studentLedger(schoolId, studentId, academicYearId);
    // A charge counts toward currentDue when it's academic, still has a balance, and is
    // due on/before the cutoff. With an explicit cutoff we compare each line's cycle
    // due date (no-date one-time heads always count); without one we fall back to the
    // ledger's "due now" bucket (arrears through the end of the current month).
    const isDue = (l: any) =>
      l.category !== "transport" && Number(l.remaining || 0) > 0 &&
      (cutoffDate ? (!l.dueDate || l.dueDate <= cutoffDate) : l.bucket === "due");
    const currentDue = Math.max(0, (led.lines || [])
      .filter(isDue)
      .reduce((s: number, l: any) => s + Number(l.remaining || 0), 0));
    const prior = await DB.query(
      singleLineString`select round(coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0), 2) as bal
        from student_ledger_entry l
        where l.school_id = $1 and l.student_id = $2 and l.status = 'active'
          and coalesce(l.category, 'fee') <> 'transport'
          and l.academic_year_id is not null and l.academic_year_id <> $3`,
      [schoolId, studentId, academicYearId],
    );
    const priorDue = Math.max(0, Number(prior[0]?.bal || 0));
    return { currentDue, priorDue };
  }

  // Roster of a section with the dues gate applied per student: academic dues split into
  // current-year (due-now) vs prior-years (transport excluded), compared to the exam's
  // two thresholds, with any god override taken into account.
  async roster(schoolId: string, examId: string, sectionClassId: string): Promise<any> {
    const exam = await this.getExam(schoolId, examId);
    if (!exam) throw new BusinessErrorResult(ErrorCode.BusinessError, "Examination not found");
    const thrCurrent = Number(exam.duesThresholdCurrent || 0);
    const thrPrior = Number(exam.duesThresholdPrior || 0);
    const section = await this.classInfo(schoolId, sectionClassId);
    const students = await this.sectionStudents(schoolId, exam.academicYearId!, sectionClassId);

    const overrideRows = await DB.query(
      singleLineString`select student_id from exam_dues_override where exam_id = $1 and status = 'active'`,
      [examId],
    );
    const overrideSet = new Set(overrideRows.map((r: any) => r.studentId));

    const printedRows = await DB.query(
      singleLineString`select student_id, to_char(printed_at, 'YYYY-MM-DD') as printed_on, print_count
        from exam_admit_card where exam_id = $1 and printed_at is not null`,
      [examId],
    );
    const printedMap = new Map<string, { printedOn: string; printCount: number }>(
      printedRows.map((r: any) => [r.studentId, { printedOn: r.printedOn, printCount: Number(r.printCount || 0) }]),
    );

    const rows: any[] = [];
    for (const s of students) {
      const { currentDue, priorDue } = await this.examDues(schoolId, s.studentId, exam.academicYearId!, exam.duesCutoffDate);
      const blocked = currentDue > thrCurrent || priorDue > thrPrior;
      const overridden = overrideSet.has(s.studentId);
      const printed = printedMap.get(s.studentId) || null;
      rows.push({
        studentId: s.studentId, name: s.name, admissionNumber: s.admissionNumber,
        currentDue, priorDue, blocked, overridden, printable: !blocked || overridden,
        printedOn: printed ? printed.printedOn : null,
        printCount: printed ? printed.printCount : 0,
      });
    }
    return {
      examId, section, thresholds: { current: thrCurrent, prior: thrPrior },
      duesCutoffDate: exam.duesCutoffDate || null,
      students: rows,
    };
  }

  // The year's fee cycles (id, name, due date) — drives the exam's "clear dues till …"
  // cutoff picker in the portal. Read-only view of the fees config; sorted chronologically.
  async feeCycles(schoolId: string, examId: string): Promise<any[]> {
    const exam = await this.getExam(schoolId, examId);
    if (!exam) throw new BusinessErrorResult(ErrorCode.BusinessError, "Examination not found");
    return DB.query(
      singleLineString`select uuid, name, to_char(due_date, 'YYYY-MM-DD') as due_date, sort_order
        from fee_cycle where school_id = $1 and academic_year_id = $2 and status = 'active'
        order by sort_order nulls last, due_date nulls last, name`,
      [schoolId, exam.academicYearId],
    );
  }

  // Print-preview summary for a class: how many cards will print, how many are blocked,
  // and the resulting page count for the chosen (or remembered) cards-per-page.
  async printPreview(schoolId: string, examId: string, sectionClassId: string, cardsPerPage?: number): Promise<any> {
    const exam = await this.getExam(schoolId, examId);
    if (!exam) throw new BusinessErrorResult(ErrorCode.BusinessError, "Examination not found");
    const per = cardsPerPage === 3 ? 3 : cardsPerPage === 4 ? 4 : (exam.cardsPerPage || 4);
    const roster = await this.roster(schoolId, examId, sectionClassId);
    const printable = roster.students.filter((s: any) => s.printable);
    const blocked = roster.students.filter((s: any) => !s.printable);
    return {
      section: roster.section,
      cardsPerPage: per,
      total: roster.students.length,
      printableCount: printable.length,
      blockedCount: blocked.length,
      overriddenCount: roster.students.filter((s: any) => s.overridden).length,
      pageCount: Math.ceil(printable.length / per),
      blocked: blocked.map((s: any) => ({ studentId: s.studentId, name: s.name, currentDue: s.currentDue, priorDue: s.priorDue })),
    };
  }

  // Lazily create (or reuse) the stable admit-card identity for a student in this exam.
  private async ensureAdmitCard(schoolId: string, examId: string, studentId: string, sectionClassId: string, userId: string): Promise<string> {
    const ex = await DB.query(
      singleLineString`select uuid from exam_admit_card where exam_id = $1 and student_id = $2`,
      [examId, studentId],
    );
    if (ex.length) return ex[0].uuid;
    const uuid = generateShortUuid(12);
    await DB.query(
      singleLineString`insert into exam_admit_card
        (uuid, school_id, exam_id, student_id, section_class_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)`,
      [uuid, schoolId, examId, studentId, sectionClassId, userId, new Date()],
    );
    return uuid;
  }

  private async brandingDataUris(schoolId: string): Promise<{ logoDataUri: string | null; stampDataUri: string | null }> {
    const rows = await DB.query(
      singleLineString`select logo_file_id, stamp_file_id from school_branding where school_id = $1`,
      [schoolId],
    );
    const toUri = async (fileId: string | null | undefined): Promise<string | null> => {
      if (!fileId) return null;
      const f = await fileStorageService.getWithData(fileId, schoolId);
      return f ? `data:${f.mimeType};base64,${f.data}` : null;
    };
    if (!rows.length) return { logoDataUri: null, stampDataUri: null };
    return { logoDataUri: await toUri(rows[0].logoFileId), stampDataUri: await toUri(rows[0].stampFileId) };
  }

  // All the data the portal needs to render printable admit cards for a section: the
  // shared header (logo/stamp/exam/AY), the grade's papers, and one card per printable
  // student (stable admit-card id + staff QR). onlyStudentIds narrows to a re-print set.
  async admitCards(schoolId: string, examId: string, sectionClassId: string, userId: string, onlyStudentIds?: string[]): Promise<any> {
    const exam = await this.getExam(schoolId, examId);
    if (!exam) throw new BusinessErrorResult(ErrorCode.BusinessError, "Examination not found");
    const section = await this.classInfo(schoolId, sectionClassId);
    if (!section) throw new BusinessErrorResult(ErrorCode.BusinessError, "Section not found");

    const ayRows = await DB.query(singleLineString`select name from academic_year where uuid = $1`, [exam.academicYearId]);
    const academicYearName = ayRows.length ? ayRows[0].name : "";

    const paperRows = await DB.query(
      singleLineString`select uuid, to_char(exam_date, 'YYYY-MM-DD') as exam_date, subject_label
        from exam_paper where exam_id = $1 and grade = $2 and status = 'active' order by exam_date`,
      [examId, section.grade],
    );
    const papers = paperRows.map((r: any) => ({ examDate: r.examDate, subjectLabel: r.subjectLabel }));
    const paperIds = paperRows.map((r: any) => r.uuid);

    // Captured invigilator signatures for this section (Phase 3): the printed/reprinted
    // card shows the signature image for present students and "ABSENT" for absentees on
    // days that were digitally signed; unsigned days stay blank for wet ink.
    const attMap = new Map<string, any>(); // `${paperId}|${studentId}` -> row
    const sigCache = new Map<string, string>(); // fileId -> dataUri
    if (paperIds.length) {
      const attRows = await DB.query(
        singleLineString`select exam_paper_id, student_id, status, signed_at, signature_file_id
          from exam_attendance where exam_id = $1 and section_class_id = $2 and exam_paper_id = any($3)`,
        [examId, sectionClassId, paperIds],
      );
      for (const a of attRows) attMap.set(`${a.examPaperId}|${a.studentId}`, a);
      const fileIds = [...new Set(attRows.filter((a: any) => a.signedAt && a.signatureFileId).map((a: any) => a.signatureFileId))];
      for (const fid of fileIds) {
        const f = await fileStorageService.getWithData(fid as string, schoolId);
        if (f) sigCache.set(fid as string, `data:${f.mimeType};base64,${f.data}`);
      }
    }

    const roster = await this.roster(schoolId, examId, sectionClassId);
    let printable = roster.students.filter((s: any) => s.printable);
    if (onlyStudentIds && onlyStudentIds.length) {
      const want = new Set(onlyStudentIds);
      printable = printable.filter((s: any) => want.has(s.studentId));
    }

    const cards = [];
    for (const s of printable) {
      const admitCardId = await this.ensureAdmitCard(schoolId, examId, s.studentId, sectionClassId, userId);
      const qrDataUri = await QRCode.toDataURL(`imsk:admit:${admitCardId}`, { margin: 1, width: 160 });
      const signatures: Record<string, any> = {};
      for (const p of paperRows) {
        const a: any = attMap.get(`${p.uuid}|${s.studentId}`);
        signatures[p.examDate] = a && a.signedAt
          ? { status: a.status, signed: true, signatureDataUri: a.status === "present" ? (sigCache.get(a.signatureFileId) || null) : null }
          : { status: a ? a.status : null, signed: false, signatureDataUri: null };
      }
      cards.push({ admitCardId, studentId: s.studentId, name: s.name, rollNo: "", qrDataUri, signatures });
    }

    return {
      exam: { name: exam.name, academicYearName, cardsPerPage: exam.cardsPerPage || 4 },
      section: { name: section.name, grade: section.grade },
      branding: await this.brandingDataUris(schoolId),
      papers,
      cards,
    };
  }

  // ── Dues overrides (god only; enforced in the handler) ─────────────────────────
  async listOverrides(schoolId: string, examId: string): Promise<any[]> {
    return DB.query(
      singleLineString`
        select o.student_id, o.reason, to_char(o.created_at, 'YYYY-MM-DD') as created_at,
          (select st.name from student st where st.uuid = o.student_id) as student_name,
          (select emp.name from employee emp where emp.uuid = o.approved_by_userid) as approved_by_name
        from exam_dues_override o
        where o.school_id = $1 and o.exam_id = $2 and o.status = 'active'
        order by o.created_at desc
      `,
      [schoolId, examId],
    );
  }

  async createOverrides(schoolId: string, examId: string, studentIds: string[], reason: string, userId: string): Promise<any[]> {
    if (!Array.isArray(studentIds) || !studentIds.length) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "studentIds is required");
    }
    const now = new Date();
    for (const studentId of studentIds) {
      const existing = await DB.query(
        singleLineString`select uuid from exam_dues_override where exam_id = $1 and student_id = $2 and status = 'active'`,
        [examId, studentId],
      );
      if (existing.length) {
        await DB.query(
          singleLineString`update exam_dues_override set reason = $3, approved_by_userid = $4, updatedby_userid = $4, updated_at = $5
            where uuid = $1 and exam_id = $2`,
          [existing[0].uuid, examId, (reason || "").slice(0, 512), userId, now],
        );
      } else {
        await DB.query(
          singleLineString`insert into exam_dues_override
            (uuid, school_id, exam_id, student_id, approved_by_userid, reason, status, created_at)
            values ($1, $2, $3, $4, $5, $6, 'active', $7)`,
          [generateShortUuid(12), schoolId, examId, studentId, userId, (reason || "").slice(0, 512), now],
        );
      }
    }
    await this.audit(schoolId, examId, "override", "create", `override for ${studentIds.length} student(s)`, userId);
    return this.listOverrides(schoolId, examId);
  }

  async revokeOverride(schoolId: string, examId: string, studentId: string, userId: string): Promise<boolean> {
    const res = await DB.query(
      singleLineString`update exam_dues_override set status = 'revoked', updatedby_userid = $4, updated_at = $5
        where school_id = $1 and exam_id = $2 and student_id = $3 and status = 'active' returning uuid`,
      [schoolId, examId, studentId, userId, new Date()],
    );
    if (!res.length) return false;
    await this.audit(schoolId, examId, "override", "revoke", `revoked override for ${studentId}`, userId);
    return true;
  }

  // ── Print log ──────────────────────────────────────────────────────────────────
  async recordPrint(schoolId: string, examId: string, sectionClassId: string, info: any, userId: string): Promise<any> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    await DB.query(
      singleLineString`insert into exam_print_log
        (uuid, school_id, exam_id, section_class_id, printedby_userid, cards_per_page, student_count, page_count, reason, note, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [uuid, schoolId, examId, sectionClassId, userId, info.cardsPerPage || null,
        info.studentCount || 0, info.pageCount || 0, info.reason || "normal", (info.note || "").slice(0, 512), now],
    );
    // Stamp the printed students' cards so the roster shows "printed" and they aren't
    // auto-reselected next time (a lost-card reprint just bumps print_count).
    const printedIds: string[] = Array.isArray(info.studentIds) ? info.studentIds.filter(Boolean) : [];
    for (const studentId of printedIds) {
      const cardId = await this.ensureAdmitCard(schoolId, examId, studentId, sectionClassId, userId);
      await DB.query(
        singleLineString`update exam_admit_card set printed_at = $2, print_count = coalesce(print_count, 0) + 1 where uuid = $1`,
        [cardId, now],
      );
    }
    await this.audit(schoolId, examId, "print", info.reason === "reprint" ? "reprint" : "print",
      `${info.studentCount || 0} card(s), ${info.pageCount || 0} page(s)`, userId);
    return { uuid };
  }

  async listPrintLog(schoolId: string, examId: string): Promise<any[]> {
    return DB.query(
      singleLineString`
        select l.section_class_id, l.cards_per_page, l.student_count, l.page_count, l.reason, l.note,
          to_char(l.created_at, 'YYYY-MM-DD HH24:MI') as created_at,
          (select c.name from class c where c.uuid = l.section_class_id) as section_name,
          (select emp.name from employee emp where emp.uuid = l.printedby_userid) as printed_by_name
        from exam_print_log l
        where l.school_id = $1 and l.exam_id = $2
        order by l.created_at desc
      `,
      [schoolId, examId],
    );
  }

  // ── Branding (central; logo + office stamp) ─────────────────────────────────────
  async getBranding(schoolId: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select logo_file_id, stamp_file_id from school_branding where school_id = $1`,
      [schoolId],
    );
    const base = rows.length ? rows[0] : { logoFileId: null, stampFileId: null };
    const uris = await this.brandingDataUris(schoolId);
    return { logoFileId: base.logoFileId || null, stampFileId: base.stampFileId || null, ...uris };
  }

  async setBrandingImage(
    schoolId: string,
    kind: "logo" | "stamp",
    base64Data: string,
    mimeType: string,
    fileName: string,
    userId: string,
  ): Promise<any> {
    if (kind !== "logo" && kind !== "stamp") throw new BusinessErrorResult(ErrorCode.BusinessError, "kind must be logo or stamp");
    if (!base64Data) throw new BusinessErrorResult(ErrorCode.BusinessError, "image data is required");
    const entityType = kind === "logo" ? "school_logo" : "school_stamp";
    const col = kind === "logo" ? "logo_file_id" : "stamp_file_id";

    const stored = await fileStorageService.upload({
      fileName: fileName || `${kind}.png`,
      mimeType: mimeType || "image/png",
      base64Data,
      entityType,
      entityId: schoolId,
      schoolId,
      userId,
    });

    const existing = await DB.query(
      singleLineString`select ${col} as file_id from school_branding where school_id = $1`,
      [schoolId],
    );
    const oldFileId = existing.length ? existing[0].fileId : null;
    const now = new Date();
    if (existing.length) {
      await DB.query(
        singleLineString`update school_branding set ${col} = $2, updatedby_userid = $3, updated_at = $4 where school_id = $1`,
        [schoolId, stored.uuid, userId, now],
      );
    } else {
      await DB.query(
        singleLineString`insert into school_branding (school_id, ${col}, updatedby_userid, updated_at) values ($1, $2, $3, $4)`,
        [schoolId, stored.uuid, userId, now],
      );
    }
    if (oldFileId) {
      try { await fileStorageService.delete(oldFileId, schoolId); } catch { /* best effort */ }
    }
    return this.getBranding(schoolId);
  }

  // ── Staff QR verify: a live view of an admit card by its stable id ──────────────
  async verifyAdmitCard(schoolId: string, admitCardId: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select exam_id, student_id, section_class_id from exam_admit_card where uuid = $1 and school_id = $2`,
      [admitCardId, schoolId],
    );
    if (!rows.length) return null;
    const { examId, studentId, sectionClassId } = rows[0];
    const exam = await this.getExam(schoolId, examId);
    const section = await this.classInfo(schoolId, sectionClassId);
    const stu = await DB.query(singleLineString`select name, admission_number from student where uuid = $1 and school_id = $2`, [studentId, schoolId]);
    const ayRows = await DB.query(singleLineString`select name from academic_year where uuid = $1`, [exam?.academicYearId]);
    const paperRows = await DB.query(
      singleLineString`select uuid, to_char(exam_date, 'YYYY-MM-DD') as exam_date, subject_label
        from exam_paper where exam_id = $1 and grade = $2 and status = 'active' order by exam_date`,
      [examId, section?.grade],
    );
    const paperIds = paperRows.map((r: any) => r.uuid);
    const attMap = new Map<string, any>();
    const empNames = new Map<string, string | null>();
    if (paperIds.length) {
      const attRows = await DB.query(
        singleLineString`select exam_paper_id, status, to_char(signed_at, 'YYYY-MM-DD HH24:MI') as signed_at, signed_by_employee_id
          from exam_attendance where exam_id = $1 and student_id = $2 and exam_paper_id = any($3)`,
        [examId, studentId, paperIds],
      );
      for (const a of attRows) attMap.set(a.examPaperId, a);
      const empIds = [...new Set(attRows.filter((a: any) => a.signedByEmployeeId).map((a: any) => a.signedByEmployeeId))];
      for (const eid of empIds) {
        const e = await DB.query(singleLineString`select name from employee where uuid = $1`, [eid as string]);
        empNames.set(eid as string, e.length ? e[0].name : null);
      }
    }
    const papers = paperRows.map((r: any) => {
      const a: any = attMap.get(r.uuid);
      return {
        examDate: r.examDate, subjectLabel: r.subjectLabel,
        status: a && a.status ? a.status : "scheduled",
        signedByName: a && a.signedAt ? (empNames.get(a.signedByEmployeeId) || null) : null,
        signedAt: a && a.signedAt ? a.signedAt : null,
      };
    });
    return {
      admitCardId,
      examName: exam?.name,
      academicYearName: ayRows.length ? ayRows[0].name : "",
      student: { name: stu.length ? stu[0].name : null, admissionNumber: stu.length ? stu[0].admissionNumber : null },
      section: section ? { name: section.name, grade: section.grade } : null,
      papers,
    };
  }

  // ── Targeted saves for the phone (one grade / one day at a time) ──────────────

  // Replace only ONE grade's papers (the PWA edits a grade at a time, so a full-grid
  // replace would wipe the other grades).
  async savePapersForGrade(schoolId: string, examId: string, grade: string, cells: any[], userId: string): Promise<GridView> {
    const exam = await this.requireExam(schoolId, examId);
    if (exam.status === "archived") throw new BusinessErrorResult(ErrorCode.BusinessError, "Cannot edit an archived exam");
    const g = (grade || "").trim();
    if (!g) throw new BusinessErrorResult(ErrorCode.BusinessError, "grade is required");
    if (!Array.isArray(cells)) throw new BusinessErrorResult(ErrorCode.BusinessError, "papers must be an array");
    const seen = new Map<string, string>();
    for (const c of cells) {
      const subject = (c.subjectLabel || "").trim();
      if (!isValidDate(c.examDate) || !subject) continue;
      seen.set(c.examDate, subject.slice(0, 256));
    }
    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();
    queries.push(
      singleLineString`update exam_paper set status = 'deleted', updatedby_userid = $3, updated_at = $4
        where exam_id = $1 and grade = $2 and status = 'active'`,
    );
    params.push([examId, g, userId, now]);
    for (const [date, subject] of seen) {
      queries.push(
        singleLineString`insert into exam_paper
          (uuid, school_id, exam_id, grade, exam_date, subject_label, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, 'active', $7, $8)`,
      );
      params.push([generateShortUuid(12), schoolId, examId, g, date, subject, userId, now]);
    }
    await DB.queriesInTransaction(queries, params);
    await this.audit(schoolId, examId, "paper", "save", `grade ${g}: ${seen.size} paper(s)`, userId);
    return this.getGrid(schoolId, examId);
  }

  // Replace only ONE date's invigilator assignments (the PWA assigns a day at a time).
  async saveInvigilatorsForDate(schoolId: string, examId: string, examDate: string, assignments: any[], userId: string): Promise<InvigilatorView> {
    const exam = await this.requireExam(schoolId, examId);
    if (exam.status === "archived") throw new BusinessErrorResult(ErrorCode.BusinessError, "Cannot edit an archived exam");
    if (!isValidDate(examDate)) throw new BusinessErrorResult(ErrorCode.BusinessError, "date must be YYYY-MM-DD");
    if (!Array.isArray(assignments)) throw new BusinessErrorResult(ErrorCode.BusinessError, "assignments must be an array");
    const seen = new Map<string, string>();
    for (const a of assignments) {
      const employeeId = (a.employeeId || "").trim();
      const sectionClassId = (a.sectionClassId || "").trim();
      if (!sectionClassId || !employeeId) continue;
      seen.set(sectionClassId, employeeId);
    }
    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();
    queries.push(
      singleLineString`update exam_invigilator set status = 'deleted', updatedby_userid = $3, updated_at = $4
        where exam_id = $1 and exam_date = $2 and status = 'active'`,
    );
    params.push([examId, examDate, userId, now]);
    for (const [sectionClassId, employeeId] of seen) {
      queries.push(
        singleLineString`insert into exam_invigilator
          (uuid, school_id, exam_id, exam_date, section_class_id, employee_id, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, 'active', $7, $8)`,
      );
      params.push([generateShortUuid(12), schoolId, examId, examDate, sectionClassId, employeeId, userId, now]);
    }
    await DB.queriesInTransaction(queries, params);
    await this.audit(schoolId, examId, "invigilator", "save", `${examDate}: ${seen.size} assignment(s)`, userId);
    return this.getInvigilators(schoolId, examId);
  }

  // ── Read surfaces open to all staff / Student 360 ─────────────────────────────

  // Published exams for a year — the read-only "Exam Schedule" list (any staff member).
  async publishedExams(schoolId: string, academicYearId: string): Promise<any[]> {
    return DB.query(
      singleLineString`select uuid, name from examination
        where school_id = $1 and academic_year_id = $2 and status = 'published'
        order by created_at desc nulls last, name`,
      [schoolId, academicYearId],
    );
  }

  // Read-only datesheet grid for a PUBLISHED exam (open to all staff).
  async scheduleGrid(schoolId: string, examId: string): Promise<GridView> {
    const exam = await this.getExam(schoolId, examId);
    if (!exam || exam.status !== "published") {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Exam schedule not available");
    }
    return this.getGrid(schoolId, examId);
  }

  // A student's admit-card / dues status across published exams — powers the
  // Examinations block on Student 360 (reached via the Ctrl+K name search).
  async studentExamStatus(schoolId: string, studentId: string): Promise<any[]> {
    const exams = await DB.query(
      singleLineString`select uuid, name, academic_year_id, grades, dues_threshold_current, dues_threshold_prior,
          to_char(dues_cutoff_date, 'YYYY-MM-DD') as dues_cutoff_date
        from examination where school_id = $1 and status = 'published'
        order by created_at desc nulls last`,
      [schoolId],
    );
    const out: any[] = [];
    for (const e of exams) {
      const cls = await DB.query(
        singleLineString`select c.uuid, c.name from student_class sc
          join class c on c.uuid = sc.class_id and c.school_id = sc.school_id
          where sc.student_id = $1 and sc.academic_year_id = $2 and sc.school_id = $3
            and (sc.status is null or sc.status <> 'deleted') limit 1`,
        [studentId, e.academicYearId, schoolId],
      );
      if (!cls.length) continue;
      const grade = gradeOf(cls[0].name);
      const grades = e.grades ? String(e.grades).split(",").map((g: string) => g.trim()) : null;
      if (grades && grades.length && !grades.includes(grade)) continue;
      const thrCurrent = Number(e.duesThresholdCurrent || 0), thrPrior = Number(e.duesThresholdPrior || 0);
      const { currentDue, priorDue } = await this.examDues(schoolId, studentId, e.academicYearId, e.duesCutoffDate);
      const blocked = currentDue > thrCurrent || priorDue > thrPrior;
      const ov = await DB.query(
        singleLineString`select 1 from exam_dues_override where exam_id = $1 and student_id = $2 and status = 'active' limit 1`,
        [e.uuid, studentId],
      );
      const ac = await DB.query(
        singleLineString`select uuid, to_char(printed_at, 'YYYY-MM-DD') as printed_on from exam_admit_card where exam_id = $1 and student_id = $2`,
        [e.uuid, studentId],
      );
      const ayName = await DB.query(singleLineString`select name from academic_year where uuid = $1`, [e.academicYearId]);
      out.push({
        examId: e.uuid, examName: e.name, academicYearName: ayName.length ? ayName[0].name : "",
        className: cls[0].name, currentDue, priorDue, blocked, overridden: ov.length > 0,
        printable: !blocked || ov.length > 0,
        printedOn: ac.length ? ac[0].printedOn : null, admitCardId: ac.length ? ac[0].uuid : null,
      });
    }
    return out;
  }

  // ════ Phase 3: employee signatures + exam attendance / invigilation ═════════════

  private async attAudit(
    schoolId: string, examId: string, examPaperId: string, sectionClassId: string,
    studentId: string | null, action: string, oldStatus: string | null, newStatus: string | null,
    employeeId: string, note: string | null,
  ): Promise<void> {
    await DB.query(
      singleLineString`insert into exam_attendance_audit
        (uuid, school_id, exam_id, exam_paper_id, section_class_id, student_id, action, old_status, new_status, employee_id, note, at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [generateShortUuid(12), schoolId, examId, examPaperId, sectionClassId, studentId, action, oldStatus, newStatus, employeeId, note ? note.slice(0, 256) : null, new Date()],
    );
  }

  private async signatureFileId(schoolId: string, employeeId: string): Promise<string | null> {
    const rows = await DB.query(
      singleLineString`select uuid from file_storage where school_id = $1 and entity_type = 'employee_signature' and entity_id = $2 order by created_at desc limit 1`,
      [schoolId, employeeId],
    );
    return rows.length ? rows[0].uuid : null;
  }

  // ── Employee signature (draw-on-canvas PNG, one per employee) ─────────────────
  async employeeSignature(schoolId: string, employeeId: string): Promise<{ fileId: string | null; dataUri: string | null }> {
    const fileId = await this.signatureFileId(schoolId, employeeId);
    if (!fileId) return { fileId: null, dataUri: null };
    const f = await fileStorageService.getWithData(fileId, schoolId);
    return { fileId, dataUri: f ? `data:${f.mimeType};base64,${f.data}` : null };
  }

  async saveEmployeeSignature(schoolId: string, employeeId: string, base64Data: string, mimeType: string, fileName: string): Promise<any> {
    if (!base64Data) throw new BusinessErrorResult(ErrorCode.BusinessError, "signature image is required");
    const old = await DB.query(
      singleLineString`select uuid from file_storage where school_id = $1 and entity_type = 'employee_signature' and entity_id = $2`,
      [schoolId, employeeId],
    );
    await fileStorageService.upload({
      fileName: fileName || "signature.png", mimeType: mimeType || "image/png",
      base64Data, entityType: "employee_signature", entityId: employeeId, schoolId, userId: employeeId,
    });
    for (const o of old) { try { await fileStorageService.delete(o.uuid, schoolId); } catch { /* best effort */ } }
    return this.employeeSignature(schoolId, employeeId);
  }

  private async paperById(examId: string, examPaperId: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select to_char(exam_date, 'YYYY-MM-DD') as exam_date, grade, subject_label
        from exam_paper where uuid = $1 and exam_id = $2 and status = 'active'`,
      [examPaperId, examId],
    );
    if (!rows.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "Exam paper not found");
    return rows[0];
  }

  async isAssignedInvigilator(examId: string, examDate: string, sectionClassId: string, employeeId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from exam_invigilator where exam_id = $1 and exam_date = $2 and section_class_id = $3 and employee_id = $4 and status = 'active' limit 1`,
      [examId, examDate, sectionClassId, employeeId],
    );
    return rows.length > 0;
  }

  // Is this employee the assigned invigilator for (paper, section)? Gate for the PWA.
  async isMyRoster(examId: string, examPaperId: string, sectionClassId: string, employeeId: string): Promise<boolean> {
    const p = await DB.query(
      singleLineString`select to_char(exam_date, 'YYYY-MM-DD') as exam_date from exam_paper where uuid = $1 and exam_id = $2 and status = 'active'`,
      [examPaperId, examId],
    );
    if (!p.length) return false;
    return this.isAssignedInvigilator(examId, p[0].examDate, sectionClassId, employeeId);
  }

  // The logged-in employee's invigilation duties (published exams), each with its paper
  // and a marked/signed summary — the PWA "my duties" list.
  async myInvigilations(schoolId: string, employeeId: string): Promise<any[]> {
    const rows = await DB.query(
      singleLineString`
        select i.exam_id, to_char(i.exam_date, 'YYYY-MM-DD') as exam_date, i.section_class_id,
          e.name as exam_name, e.academic_year_id, c.name as section_name
        from exam_invigilator i
        join examination e on e.uuid = i.exam_id and e.status = 'published'
        join class c on c.uuid = i.section_class_id
        where i.school_id = $1 and i.employee_id = $2 and i.status = 'active'
        order by i.exam_date, c.name
      `,
      [schoolId, employeeId],
    );
    const out: any[] = [];
    for (const r of rows) {
      const grade = gradeOf(r.sectionName);
      const paperRows = await DB.query(
        singleLineString`select uuid, subject_label from exam_paper where exam_id = $1 and grade = $2 and exam_date = $3 and status = 'active'`,
        [r.examId, grade, r.examDate],
      );
      if (!paperRows.length) continue; // no paper that grade sits this date
      const paper = paperRows[0];
      const att = await DB.query(
        singleLineString`select status, signed_at from exam_attendance where exam_paper_id = $1 and section_class_id = $2`,
        [paper.uuid, r.sectionClassId],
      );
      const totalRows = await DB.query(
        singleLineString`select count(*) as c from student_class sc
          join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status = 'active'
          where sc.class_id = $1 and sc.academic_year_id = $2 and sc.school_id = $3 and (sc.status is null or sc.status <> 'deleted')`,
        [r.sectionClassId, r.academicYearId, schoolId],
      );
      out.push({
        examId: r.examId, examName: r.examName, examDate: r.examDate,
        sectionClassId: r.sectionClassId, sectionName: r.sectionName,
        paperId: paper.uuid, subjectLabel: paper.subjectLabel,
        total: Number(totalRows[0].c || 0),
        marked: att.filter((a: any) => a.status).length,
        signed: att.some((a: any) => a.signedAt),
      });
    }
    return out;
  }

  // Attendance roster for a (paper, section): students + current present/absent + whether
  // the roster is signed (and by whom).
  async attendanceRoster(schoolId: string, examId: string, examPaperId: string, sectionClassId: string): Promise<any> {
    const exam = await this.getExam(schoolId, examId);
    if (!exam) throw new BusinessErrorResult(ErrorCode.BusinessError, "Examination not found");
    const paper = await this.paperById(examId, examPaperId);
    const section = await this.classInfo(schoolId, sectionClassId);
    const students = await this.sectionStudents(schoolId, exam.academicYearId!, sectionClassId);
    const attRows = await DB.query(
      singleLineString`select student_id, status, signed_by_employee_id,
          to_char(signed_at, 'YYYY-MM-DD HH24:MI') as signed_at
        from exam_attendance where exam_paper_id = $1 and section_class_id = $2`,
      [examPaperId, sectionClassId],
    );
    const attMap = new Map(attRows.map((r: any) => [r.studentId, r]));
    const signer = attRows.find((r: any) => r.signedAt);
    let signedByName: string | null = null;
    if (signer) {
      const emp = await DB.query(singleLineString`select name from employee where uuid = $1`, [signer.signedByEmployeeId]);
      signedByName = emp.length ? emp[0].name : null;
    }
    const rowsOut = students.map((s: any) => {
      const a: any = attMap.get(s.studentId);
      return { studentId: s.studentId, name: s.name, admissionNumber: s.admissionNumber, status: a ? a.status : null };
    });
    return {
      paper: { examDate: paper.examDate, subjectLabel: paper.subjectLabel, grade: paper.grade },
      section, signed: !!signer, signedByName, signedAt: signer ? signer.signedAt : null,
      total: rowsOut.length, markedCount: rowsOut.filter((r: any) => r.status).length,
      students: rowsOut,
    };
  }

  // Mark present/absent for a set of students on a (paper, section). Append-only audit
  // for every change. Signing is a separate step.
  async markAttendance(schoolId: string, examId: string, examPaperId: string, sectionClassId: string, marks: any[], employeeId: string): Promise<any> {
    const paper = await this.paperById(examId, examPaperId);
    if (!Array.isArray(marks)) throw new BusinessErrorResult(ErrorCode.BusinessError, "marks must be an array");
    const now = new Date();
    for (const m of marks) {
      const studentId = (m.studentId || "").trim();
      const status = m.status === "present" ? "present" : m.status === "absent" ? "absent" : null;
      if (!studentId || !status) continue;
      const ex = await DB.query(
        singleLineString`select uuid, status from exam_attendance where exam_paper_id = $1 and student_id = $2`,
        [examPaperId, studentId],
      );
      if (ex.length) {
        if (ex[0].status !== status) {
          await DB.query(
            singleLineString`update exam_attendance set status = $2, updatedby_userid = $3, updated_at = $4 where uuid = $1`,
            [ex[0].uuid, status, employeeId, now],
          );
          await this.attAudit(schoolId, examId, examPaperId, sectionClassId, studentId, status === "present" ? "mark_present" : "mark_absent", ex[0].status, status, employeeId, null);
        }
      } else {
        await DB.query(
          singleLineString`insert into exam_attendance
            (uuid, school_id, exam_id, exam_paper_id, exam_date, section_class_id, student_id, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [generateShortUuid(12), schoolId, examId, examPaperId, paper.examDate, sectionClassId, studentId, status, employeeId, now],
        );
        await this.attAudit(schoolId, examId, examPaperId, sectionClassId, studentId, status === "present" ? "mark_present" : "mark_absent", null, status, employeeId, null);
      }
    }
    return this.attendanceRoster(schoolId, examId, examPaperId, sectionClassId);
  }

  // Sign the roster: requires every student marked and the signer to have a stored
  // signature. Stamps signed_by / signed_at / signature_file_id on all rows for that
  // (paper, section). Re-signing is allowed (post-sign edit) and audited as 'resign'.
  async signRoster(schoolId: string, examId: string, examPaperId: string, sectionClassId: string, employeeId: string): Promise<any> {
    const exam = await this.getExam(schoolId, examId);
    if (!exam) throw new BusinessErrorResult(ErrorCode.BusinessError, "Examination not found");
    await this.paperById(examId, examPaperId);
    const students = await this.sectionStudents(schoolId, exam.academicYearId!, sectionClassId);
    const attRows = await DB.query(
      singleLineString`select student_id, status, signed_at from exam_attendance where exam_paper_id = $1 and section_class_id = $2`,
      [examPaperId, sectionClassId],
    );
    const statusMap = new Map(attRows.map((r: any) => [r.studentId, r.status]));
    const unmarked = students.filter((s: any) => !statusMap.get(s.studentId));
    if (unmarked.length) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Mark all ${students.length} students before signing (${unmarked.length} still unmarked)`);
    }
    const sigFileId = await this.signatureFileId(schoolId, employeeId);
    if (!sigFileId) throw new BusinessErrorResult(ErrorCode.BusinessError, "Add your signature first (Profile → Signature), then sign the roster");
    const already = attRows.some((r: any) => r.signedAt);
    const now = new Date();
    await DB.query(
      singleLineString`update exam_attendance set signed_by_employee_id = $3, signed_at = $4, signature_file_id = $5, updatedby_userid = $3, updated_at = $4
        where exam_paper_id = $1 and section_class_id = $2`,
      [examPaperId, sectionClassId, employeeId, now, sigFileId],
    );
    await this.attAudit(schoolId, examId, examPaperId, sectionClassId, null, already ? "resign" : "sign", null, null, employeeId, `signed ${students.length} students`);
    return this.attendanceRoster(schoolId, examId, examPaperId, sectionClassId);
  }
}

export const examinationService = new ExaminationService();
