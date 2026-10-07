// Attendance module constants.

export const ATTENDANCE_STATUSES = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' },
  { value: 'leave', label: 'Leave' },
  { value: 'half_day', label: 'Half Day' },
] as const;

export const ATTENDANCE_STATUS_VALUES = ['present', 'absent', 'late', 'leave', 'half_day'] as const;
export const SESSION_STATUSES = ['open', 'finalized'] as const;
export const AUDIT_SOURCES = ['mark', 'edit', 'finalize'] as const;

// How a half-day counts toward the attendance %. Per-school, set on the Config screen.
//   half     — 0.5 day (counts in working days, contributes half to the numerator)  [factory default]
//   full     — a full present (counts fully; doesn't lower the %)
//   excluded — not a working day at all (removed from the denominator, like leave)
export const HALF_DAY_WEIGHTS = ['half', 'full', 'excluded'] as const;
export type HalfDayWeight = typeof HALF_DAY_WEIGHTS[number];

export const DEFAULTS = {
  PRESENT: 'present',
  SESSION_OPEN: 'open',
  // Attendance config factory defaults (used when a school has no attendance_config row).
  HALF_DAY_ENABLED: true,
  HALF_DAY_WEIGHT: 'half' as HalfDayWeight,
} as const;

// Communication template key used to notify families of an absence on finalize.
export const ABSENT_TEMPLATE_KEY = 'attendance_absent';

export type AttendanceStatus = typeof ATTENDANCE_STATUS_VALUES[number];
export type SessionStatus = typeof SESSION_STATUSES[number];
export type AuditSource = typeof AUDIT_SOURCES[number];
