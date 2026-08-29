// ── Examination header + config ─────────────────────────────────────────────────
export interface Examination {
  uuid: string;
  academicYearId: string;
  name: string;
  status: string; // draft | published | archived
  inchargeEmployeeId?: string | null;
  inchargeName?: string | null;
  duesThresholdCurrent?: number | null;
  duesThresholdPrior?: number | null;
  cardsPerPage?: number | null;
  grades?: string[] | null; // grades this exam covers; null = all available
  duesCutoffDate?: string | null; // dues checked on/before this date; null = due-now
  hasInvigilation?: boolean; // false = datesheet-only exam (no invigilator assignment)
  hasAdmitCards?: boolean; // false = no admit cards issued
  datesheetNotes?: string | null; // printed under the datesheet PDF (one note per line)
  startDate?: string | null;
  endDate?: string | null;
  paperCount?: number;
}

export interface CreateExamRequest {
  name: string;
  academicYearId?: string;
  inchargeEmployeeId?: string | null;
  cardsPerPage?: number;
  hasInvigilation?: boolean; // default true
  hasAdmitCards?: boolean; // default true
}

export interface UpdateExamRequest {
  name?: string;
  status?: string; // publish/unpublish/archive transitions
  inchargeEmployeeId?: string | null;
  cardsPerPage?: number;
  grades?: string[]; // the grades this exam covers (empty/undefined = all available)
  duesCutoffDate?: string | null; // YYYY-MM-DD; null clears it (back to due-now)
  hasInvigilation?: boolean;
  hasAdmitCards?: boolean;
  datesheetNotes?: string | null;
  // god-only (enforced in the handler): the two dues thresholds.
  duesThresholdCurrent?: number | null;
  duesThresholdPrior?: number | null;
}

// ── Datesheet grid (grade × date) ────────────────────────────────────────────────
export interface ExamPaperCell {
  grade: string;
  examDate: string; // yyyy-mm-dd
  subjectLabel: string;
}

export interface GridGrade {
  grade: string;
  seq: number; // ordering across columns
}

export interface GridView {
  examId: string;
  status: string;
  grades: GridGrade[]; // columns actually shown (the exam's included grades)
  availableGrades: GridGrade[]; // every grade that has sections in the year (pick list)
  dates: string[]; // rows (distinct paper dates, sorted)
  papers: ExamPaperCell[]; // filled cells
}

export interface SavePapersRequest {
  papers: ExamPaperCell[]; // the full set of filled cells; replaces existing
}

// ── Invigilator assignment (date × section) ──────────────────────────────────────
export interface GridSection {
  classId: string;
  name: string;
  grade: string;
  seq: number;
}

export interface InvigilatorAssignment {
  examDate: string;
  sectionClassId: string;
  employeeId: string;
  employeeName?: string | null;
}

export interface InvigilatorView {
  examId: string;
  dates: string[]; // columns (distinct paper dates)
  sections: GridSection[]; // rows
  // gradesByDate[date] = the set of grades that have a paper that date; a (date,
  // section) cell is assignable only when the section's grade is in this set.
  gradesByDate: Record<string, string[]>;
  assignments: InvigilatorAssignment[];
  conflicts: Array<{ examDate: string; employeeId: string; sectionClassIds: string[] }>;
}

export interface SaveInvigilatorsRequest {
  assignments: Array<{ examDate: string; sectionClassId: string; employeeId: string }>;
}
