import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per leave endpoint, keyed by the `handler:` reference in
// leave-endpoints.yml (`file.export`). Single naming site for leave authz — wired at the
// export site of each handler via guard(). Effective permission honours god's live
// grant/revoke overrides (see shared/lib/authz-policy.ts can()).
//
// Teacher/admin hold calendar.view (shared who's-on-leave) + application.apply (self-service);
// everything else is god-only for now (god opens cells per-role via the Permissions grid).
const {
  LEAVE_CALENDAR_VIEW,
  LEAVE_APPLICATION_APPLY,
  LEAVE_APPLICATION_VIEW,
  LEAVE_APPLICATION_APPROVE,
  LEAVE_CONFIG_VIEW,
  LEAVE_CONFIG_MANAGE,
  LEAVE_ATTENDANCE_VIEW,
  LEAVE_ATTENDANCE_MANAGE,
  LEAVE_DEDUCTION_VIEW,
  LEAVE_DEDUCTION_MANAGE,
} = ACTIONS;

export const LEAVE_ACTIONS: Record<string, string> = {
  // Policy config + leave-type master (config resource)
  "leave-handler.getConfig": LEAVE_CONFIG_VIEW,
  "leave-handler.updateConfig": LEAVE_CONFIG_MANAGE,
  "leave-handler.listTypes": LEAVE_CONFIG_VIEW,
  "leave-handler.updateType": LEAVE_CONFIG_MANAGE,

  // Shared "who's on leave" calendar + coverage handover (calendar resource)
  "leave-handler.listApplications": LEAVE_CALENDAR_VIEW,
  "leave-handler.getHandover": LEAVE_CALENDAR_VIEW,
  "leave-handler.getHandoverFile": LEAVE_CALENDAR_VIEW,

  // Oversight read of a single application (application resource — view)
  "leave-handler.getApplication": LEAVE_APPLICATION_VIEW,
  "leave-handler.getAttachment": LEAVE_APPLICATION_VIEW,
  "leave-handler.getAudit": LEAVE_APPLICATION_VIEW,
  "leave-handler.summary": LEAVE_APPLICATION_VIEW,
  "leave-handler.balance": LEAVE_APPLICATION_VIEW,

  // Approve / reject (application resource — approve)
  "leave-handler.approve": LEAVE_APPLICATION_APPROVE,
  "leave-handler.reject": LEAVE_APPLICATION_APPROVE,

  // Self-service: the employee's own /me surface (application resource — apply)
  "leave-me-handler.listTypes": LEAVE_APPLICATION_APPLY,
  "leave-me-handler.handoverPreview": LEAVE_APPLICATION_APPLY,
  "leave-me-handler.summary": LEAVE_APPLICATION_APPLY,
  "leave-me-handler.listApplications": LEAVE_APPLICATION_APPLY,
  "leave-me-handler.apply": LEAVE_APPLICATION_APPLY,
  "leave-me-handler.cancel": LEAVE_APPLICATION_APPLY,
  "leave-me-handler.attendance": LEAVE_APPLICATION_APPLY,
  "leave-me-handler.deductions": LEAVE_APPLICATION_APPLY,
  "leave-me-handler.getAttachment": LEAVE_APPLICATION_APPLY,
  "leave-me-handler.covering": LEAVE_APPLICATION_APPLY,
  "leave-me-handler.getCovering": LEAVE_APPLICATION_APPLY,
  "leave-me-handler.getCoveringFile": LEAVE_APPLICATION_APPLY,

  // Biometric attendance reconciliation (attendance resource)
  "leave-attendance-handler.listMap": LEAVE_ATTENDANCE_VIEW,
  "leave-attendance-handler.employeeAttendance": LEAVE_ATTENDANCE_VIEW,
  "leave-attendance-handler.dayView": LEAVE_ATTENDANCE_VIEW,
  "leave-attendance-handler.mark": LEAVE_ATTENDANCE_MANAGE,
  "leave-attendance-handler.importFile": LEAVE_ATTENDANCE_MANAGE,
  "leave-attendance-handler.importTimewatch": LEAVE_ATTENDANCE_MANAGE,
  "leave-attendance-handler.mapEnroll": LEAVE_ATTENDANCE_MANAGE,

  // Deduction (LOP) report (deduction resource)
  "leave-deduction-handler.list": LEAVE_DEDUCTION_VIEW,
  "leave-deduction-handler.employeeDeduction": LEAVE_DEDUCTION_VIEW,
  "leave-deduction-handler.run": LEAVE_DEDUCTION_MANAGE,
  "leave-deduction-handler.finalize": LEAVE_DEDUCTION_MANAGE,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
export const LEAVE_PUBLIC: string[] = ["health-handler.health"];
