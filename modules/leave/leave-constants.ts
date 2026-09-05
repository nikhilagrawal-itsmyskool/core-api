// Leave module constants.

export const APPLICATION_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const TYPE_STATUSES = ["active", "inactive", "deleted"] as const;
export type TypeStatus = (typeof TYPE_STATUSES)[number];

// Policy defaults (overridable per school via leave_config).
export const DEFAULT_CL_PER_MONTH = 1;
export const DEFAULT_DAILY_CAP = 2;

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
  countsVsQuota: boolean;
  requiresAttachment: boolean;
  waivable: boolean;
  approverRole: string;
  sortOrder: number;
}

export const LEAVE_TYPE_SEED: LeaveTypeSeed[] = [
  { code: "CL", name: "Casual Leave", paid: "yes", countsVsQuota: true, requiresAttachment: false, waivable: false, approverRole: "god", sortOrder: 1 },
  { code: "ML", name: "Medical Leave", paid: "yes", countsVsQuota: false, requiresAttachment: true, waivable: true, approverRole: "god", sortOrder: 2 },
  { code: "OD", name: "On Duty (Exam / Official)", paid: "yes", countsVsQuota: false, requiresAttachment: false, waivable: true, approverRole: "god", sortOrder: 3 },
  { code: "COMP", name: "Compensatory Off", paid: "yes", countsVsQuota: false, requiresAttachment: false, waivable: false, approverRole: "god", sortOrder: 4 },
  { code: "MAT", name: "Maternity Leave", paid: "yes", countsVsQuota: false, requiresAttachment: true, waivable: false, approverRole: "god", sortOrder: 5 },
  { code: "EMERG", name: "Emergency / Family", paid: "discretionary", countsVsQuota: false, requiresAttachment: false, waivable: true, approverRole: "god", sortOrder: 6 },
  { code: "LWP", name: "Leave Without Pay", paid: "no", countsVsQuota: false, requiresAttachment: false, waivable: false, approverRole: "god", sortOrder: 7 },
];
