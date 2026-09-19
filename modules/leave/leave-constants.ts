// Leave module constants.

export const APPLICATION_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const TYPE_STATUSES = ["active", "inactive", "deleted"] as const;
export type TypeStatus = (typeof TYPE_STATUSES)[number];

// Policy defaults (overridable per school). Allocations are annual (per academic year,
// lapse 31 Mar) and live per-type as leave_type.annual_quota — see LEAVE_TYPE_SEED.
export const DEFAULT_CL_PER_YEAR = 8;
export const DEFAULT_ML_PER_YEAR = 4;
export const DEFAULT_DAILY_CAP = 2; // max staff on leave per working day (school-wide)
// Legacy monthly-CL cap — no longer enforced (quota is annual). Kept for the config row.
export const DEFAULT_CL_PER_MONTH = 1;

// File attachment (medical certificate etc.).
export const FILE_ENTITY_TYPE = "leave";
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const ATTACHMENT_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

// Notification keys (consumed by the communication in-app inbox).
export const NOTIFY = {
  APPLIED: "leave_applied",       // -> approvers
  APPROVED: "leave_approved",     // -> applicant
  REJECTED: "leave_rejected",     // -> applicant
  CANCELLED: "leave_cancelled",   // -> applicant (self-serve confirm)
} as const;

// Roles that may approve/reject + see oversight (staff records, reports, config).
// GOD-ONLY for now, by decision — admins are treated like teachers (self-service only).
// This is the single flip point: add "admin" here (and grant admin the `leave.manage`
// permission in the portal's role map) to give office admins oversight later. See DESIGN §5.
export const APPROVER_ROLES = ["god"] as const;

// Standard leave-type seed set. `code` is the stable key; `name` is display.
// paid: yes | no | discretionary. See DESIGN.md §3.
export interface LeaveTypeSeed {
  code: string;
  name: string;
  paid: "yes" | "no" | "discretionary";
  countsVsQuota: boolean;        // legacy flag — quota is now driven by annualQuota
  requiresAttachment: boolean;
  waivable: boolean;
  approverRole: string;
  sortOrder: number;
  annualQuota: number | null;    // days/academic-year enforced at apply (null = unlimited)
  attachmentOverDays: number | null; // attachment required only when working days exceed this
  showInBalance: boolean;        // show as a balance card on the staff /me summary
  allowHalfDay: boolean;         // half-day (first/second half) permitted for this type
}

export const LEAVE_TYPE_SEED: LeaveTypeSeed[] = [
  { code: "CL", name: "Casual Leave", paid: "yes", countsVsQuota: true, requiresAttachment: false, waivable: false, approverRole: "god", sortOrder: 1, annualQuota: DEFAULT_CL_PER_YEAR, attachmentOverDays: null, showInBalance: true, allowHalfDay: true },
  { code: "ML", name: "Medical Leave", paid: "yes", countsVsQuota: true, requiresAttachment: false, waivable: true, approverRole: "god", sortOrder: 2, annualQuota: DEFAULT_ML_PER_YEAR, attachmentOverDays: 2, showInBalance: true, allowHalfDay: false },
  // Bereavement stays selectable + quota-enforced, but is not advertised as a standing balance.
  { code: "BER", name: "Bereavement Leave", paid: "yes", countsVsQuota: false, requiresAttachment: false, waivable: true, approverRole: "god", sortOrder: 3, annualQuota: 3, attachmentOverDays: null, showInBalance: false, allowHalfDay: false },
  { code: "OD", name: "On Duty (Exam / Official)", paid: "yes", countsVsQuota: false, requiresAttachment: false, waivable: true, approverRole: "god", sortOrder: 4, annualQuota: null, attachmentOverDays: null, showInBalance: true, allowHalfDay: false },
  { code: "COMP", name: "Compensatory Off", paid: "yes", countsVsQuota: false, requiresAttachment: false, waivable: false, approverRole: "god", sortOrder: 5, annualQuota: null, attachmentOverDays: null, showInBalance: true, allowHalfDay: false },
  // Maternity (MAT) intentionally omitted for now — add back when needed.
  { code: "EMERG", name: "Emergency / Family", paid: "discretionary", countsVsQuota: false, requiresAttachment: false, waivable: true, approverRole: "god", sortOrder: 6, annualQuota: null, attachmentOverDays: null, showInBalance: true, allowHalfDay: false },
  { code: "LWP", name: "Leave Without Pay", paid: "no", countsVsQuota: false, requiresAttachment: false, waivable: false, approverRole: "god", sortOrder: 7, annualQuota: null, attachmentOverDays: null, showInBalance: true, allowHalfDay: true },
];
