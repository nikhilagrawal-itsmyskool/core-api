import { FeedbackStatus } from "./feedback-constants";

// ---- Category ----
export interface FeedbackCategoryView {
  uuid: string;
  name: string;
  sortOrder: number | null;
  status: string;
}

// ---- Write requests ----
export interface RecordFeedbackRequest {
  studentId: string;
  classId?: string; // snapshot of the student's class at record time (optional)
  academicYearId?: string; // resolved to current AY when omitted
  categoryId: string;
  feedbackText: string;
  visitDate?: string; // YYYY-MM-DD, defaults to today (IST)
  assignedTo: string; // teacher employee uuid
}

export interface RespondRequest {
  comment: string;
}

export interface ReviewRequest {
  note?: string;
}

// ---- Read models ----
export interface FeedbackView {
  uuid: string;
  academicYearId: string | null;
  studentId: string;
  studentName: string | null;
  admissionNumber: string | null;
  classId: string | null;
  className: string | null;
  categoryId: string | null;
  categoryName: string | null;
  feedbackText: string;
  visitDate: string | null;
  assignedTo: string;
  assignedToName: string | null;
  recordedBy: string | null;
  recordedByName: string | null;
  teacherComment: string | null;
  respondedBy: string | null;
  respondedByName: string | null;
  respondedAt: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  status: FeedbackStatus;
  createdAt: string | null;
}

export interface FeedbackAuditRow {
  uuid: string;
  feedbackId: string;
  action: string;
  detail: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  changedbyUserid: string | null;
  changedbyName?: string | null;
  changedAt: string | null;
}

// Director dashboard rollup.
export interface TeacherBreakupRow {
  employeeId: string;
  employeeName: string | null;
  assigned: number;   // includes reopened (still on the teacher's plate)
  responded: number;  // waiting on the director
  completed: number;
  open: number;       // assigned + responded + reopened
  total: number;
}

export interface FeedbackSummary {
  byStatus: { assigned: number; responded: number; completed: number; reopened: number };
  open: number;
  byTeacher: TeacherBreakupRow[];
}
