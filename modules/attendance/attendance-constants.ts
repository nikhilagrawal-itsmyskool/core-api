// Attendance module constants.

export const ATTENDANCE_STATUSES = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' },
  { value: 'leave', label: 'Leave' },
] as const;

export const ATTENDANCE_STATUS_VALUES = ['present', 'absent', 'late', 'leave'] as const;
export const SESSION_STATUSES = ['open', 'finalized'] as const;
export const AUDIT_SOURCES = ['mark', 'edit', 'finalize'] as const;

export const DEFAULTS = {
  PRESENT: 'present',
  SESSION_OPEN: 'open',
} as const;

// Communication template key used to notify families of an absence on finalize.
export const ABSENT_TEMPLATE_KEY = 'attendance_absent';

export type AttendanceStatus = typeof ATTENDANCE_STATUS_VALUES[number];
export type SessionStatus = typeof SESSION_STATUSES[number];
export type AuditSource = typeof AUDIT_SOURCES[number];
