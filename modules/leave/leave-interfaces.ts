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
}

// ---- Write requests ----
export interface ApplyLeaveRequest {
  leaveTypeCode: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  reason?: string;
  attachment?: AttachmentInput;
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
}

// Monthly balance for one employee.
export interface LeaveBalanceView {
  employeeId: string;
  month: string; // YYYY-MM
  clPerMonth: number;
  clUsed: number; // CL applications counted this month (pending + approved)
  clRemaining: number;
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
