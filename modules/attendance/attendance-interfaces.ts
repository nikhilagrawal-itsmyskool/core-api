import { AttendanceStatus, SessionStatus, AuditSource } from './attendance-constants';

export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// ------------------------------------------------------------------- Session
export interface AttendanceSession extends BaseEntity {
  academicYearId: string;
  classId: string;
  attendanceDate: string;
  status: SessionStatus;
  finalizedAt?: Date;
}

export interface OpenSessionRequest {
  classId: string;
  academicYearId: string;
  date: string; // yyyy-mm-dd; may be a past date (back-dating)
}

// -------------------------------------------------------------------- Record
export interface AttendanceRecord extends BaseEntity {
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  remark?: string;
  // joined for display
  studentName?: string;
  admissionNumber?: string;
}

export interface MarkEntry {
  studentId: string;
  status: AttendanceStatus;
  remark?: string;
}

export interface SaveMarksRequest {
  marks: MarkEntry[];
}

export interface EditRecordRequest {
  status?: AttendanceStatus;
  remark?: string;
}

// --------------------------------------------------------------------- Audit
export interface AttendanceAudit {
  uuid: string;
  schoolId: string;
  sessionId: string;
  recordId?: string;
  studentId: string;
  oldStatus?: string;
  newStatus?: string;
  source: AuditSource;
  changedbyUserid?: string;
  changedAt: Date;
}

// A roster row for the marking screen: enrolled student + any existing mark.
export interface RosterEntry {
  studentId: string;
  name: string;
  admissionNumber?: string;
  status?: AttendanceStatus;
  remark?: string;
}
