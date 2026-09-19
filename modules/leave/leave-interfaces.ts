import { ApplicationStatus } from "./leave-constants";

// ---- Attachment ----
export interface AttachmentInput {
  fileName: string;
  mimeType: string;
  base64Data: string; // raw base64, no data: URI prefix
}

// ---- Config ----
export interface LeaveConfig {
  clPerMonth: number;
  dailyCap: number;
  reset: "monthly";
}

// ---- Leave type ----
export interface LeaveTypeView {
  code: string;
  name: string;
  paid: "yes" | "no" | "discretionary";
  countsVsQuota: boolean;
  requiresAttachment: boolean;
  waivable: boolean;
  approverRole: string | null;
  sortOrder: number | null;
  status: string;
  annualQuota: number | null;         // days/academic-year (null = unlimited)
  attachmentOverDays: number | null;  // attachment required only when days exceed this
  showInBalance: boolean;             // show as a balance card on the staff /me summary
  allowHalfDay: boolean;              // half-day permitted for this type
}

// ---- Write requests ----
export interface ApplyLeaveRequest {
  leaveTypeCode: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  reason?: string;
  attachment?: AttachmentInput;
  dayPortion?: "full" | "first_half" | "second_half"; // half-day only valid on a single day
  handover?: any; // academic-handover payload (validated by leave-handover-service)
}

export interface DecisionRequest {
  note?: string;
}

// ---- Read models ----
export interface LeaveApplicationView {
  uuid: string;
  employeeId: string;
  employeeName?: string | null;
  leaveTypeCode: string;
  leaveTypeName?: string | null;
  fromDate: string;
  toDate: string;
  workingDays: number | null;
  dayPortion?: string | null; // 'full' | 'first_half' | 'second_half'
  reason: string | null;
  status: ApplicationStatus;
  appliedAt: string | null;
  decidedBy: string | null;
  decidedByName?: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  waived: boolean;
  waiverReason: string | null;
  hasAttachment: boolean;
  overridden?: boolean;        // approved past the daily cap / annual quota by an approver
  overrideReason?: string | null;
  warnings?: string[];         // soft-threshold warnings surfaced at apply time
  evaluation?: { checks: LeaveCheck[]; passes: boolean; workingDays?: number }; // rule preflight (pending rows only)
}

// One approval-rule check (daily cap / annual balance / working-days).
export interface LeaveCheck {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
}

// Result of an approve attempt. When a soft threshold (daily cap / annual quota) is hit and
// the approver has not confirmed an override, approval pauses and asks for confirmation.
export type ApproveResult =
  | { needsConfirmation: true; warnings: string[] }
  | { needsConfirmation: false; application: LeaveApplicationView; overridden: boolean };

// Annual (academic-year) balance for one employee.
export interface LeaveQuotaBalance {
  code: string;
  name: string;
  quota: number;      // days allocated for the academic year
  used: number;       // working days used (pending + approved)
  remaining: number;
}
export interface LeaveBalanceView {
  employeeId: string;
  month: string;              // YYYY-MM anchor
  academicYearStart: string;  // YYYY-MM-DD
  academicYearEnd: string;    // YYYY-MM-DD
  quotas: LeaveQuotaBalance[];
  pending: number;
  approved: number;
  rejected: number;
}

export interface LeaveAuditRow {
  uuid: string;
  applicationId: string;
  action: string;
  detail: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  changedbyUserid: string | null;
  changedbyName?: string | null;
  changedAt: string | null;
}
