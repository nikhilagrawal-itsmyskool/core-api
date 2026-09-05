import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService } from "../../shared/lib/file-storage";
import {
  findEmployee,
  approverEmployeeIds,
  workingDaysBetween,
  datesInRange,
  monthBounds,
} from "./leave-common";
import {
  DEFAULT_CL_PER_MONTH,
  DEFAULT_DAILY_CAP,
  LEAVE_TYPE_SEED,
  FILE_ENTITY_TYPE,
  ATTACHMENT_ALLOWED_MIME,
  ATTACHMENT_MAX_BYTES,
  NOTIFY,
} from "./leave-constants";
import {
  ApplyLeaveRequest,
  LeaveApplicationView,
  LeaveBalanceView,
  LeaveConfig,
  LeaveTypeView,
  LeaveAuditRow,
} from "./leave-interfaces";
import { notifyInApp } from "./leave-notify";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class LeaveService {
  // ── Config ─────────────────────────────────────────────────────────────────
  async ensureConfig(schoolId: string, userId = "system"): Promise<LeaveConfig> {
    const rows = await DB.query(
      singleLineString`select cl_per_month, daily_cap, reset from leave_config where school_id = $1 and status = 'active'`,
      [schoolId],
    );
    if (rows.length) {
      return { clPerMonth: rows[0].clPerMonth, dailyCap: rows[0].dailyCap, reset: rows[0].reset };
    }
    await DB.query(
      singleLineString`insert into leave_config (uuid, school_id, cl_per_month, daily_cap, reset, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, 'monthly', 'active', $5, $6)`,
      [generateShortUuid(12), schoolId, DEFAULT_CL_PER_MONTH, DEFAULT_DAILY_CAP, userId, new Date()],
    );
    return { clPerMonth: DEFAULT_CL_PER_MONTH, dailyCap: DEFAULT_DAILY_CAP, reset: "monthly" };
  }

  // ── Types (seeded on first use) ──────────────────────────────────────────────
  async ensureTypes(schoolId: string, userId = "system"): Promise<void> {
    const existing = await DB.query(
      singleLineString`select count(1)::int as n from leave_type where school_id = $1 and status <> 'deleted'`,
      [schoolId],
    );
    if (existing[0].n > 0) return;
    const now = new Date();
    for (const t of LEAVE_TYPE_SEED) {
      await DB.query(
        singleLineString`insert into leave_type
          (uuid, school_id, code, name, paid, counts_vs_quota, requires_attachment, waivable, approver_role, sort_order, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12)`,
        [generateShortUuid(12), schoolId, t.code, t.name, t.paid, t.countsVsQuota, t.requiresAttachment, t.waivable, t.approverRole, t.sortOrder, userId, now],
      );
    }
  }

  async listTypes(schoolId: string): Promise<LeaveTypeView[]> {
    await this.ensureTypes(schoolId);
    const rows = await DB.query(
      singleLineString`select code, name, paid, counts_vs_quota, requires_attachment, waivable, approver_role, sort_order, status
        from leave_type where school_id = $1 and status <> 'deleted' order by sort_order asc nulls last, code`,
      [schoolId],
    );
    return rows.map((r: any) => ({
      code: r.code,
      name: r.name,
      paid: r.paid,
      countsVsQuota: r.countsVsQuota,
      requiresAttachment: r.requiresAttachment,
      waivable: r.waivable,
      approverRole: r.approverRole || null,
      sortOrder: r.sortOrder,
      status: r.status,
    }));
  }

  private async getType(schoolId: string, code: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select code, name, paid, counts_vs_quota, requires_attachment, waivable from leave_type
        where school_id = $1 and lower(code) = lower($2) and status = 'active'`,
      [schoolId, code],
    );
    return rows[0] || null;
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  async apply(schoolId: string, employeeId: string, req: ApplyLeaveRequest): Promise<LeaveApplicationView> {
    if (!(await findEmployee(schoolId, employeeId))) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid employee");
    if (!req.leaveTypeCode) throw new BusinessErrorResult(ErrorCode.BusinessError, "leaveTypeCode is required");
    if (!req.fromDate || !DATE_RE.test(req.fromDate)) throw new BusinessErrorResult(ErrorCode.BusinessError, "fromDate (YYYY-MM-DD) is required");
    if (!req.toDate || !DATE_RE.test(req.toDate)) throw new BusinessErrorResult(ErrorCode.BusinessError, "toDate (YYYY-MM-DD) is required");
    if (req.toDate < req.fromDate) throw new BusinessErrorResult(ErrorCode.BusinessError, "toDate cannot be before fromDate");

    await this.ensureConfig(schoolId);
    const type = await this.getType(schoolId, req.leaveTypeCode);
    if (!type) throw new BusinessErrorResult(ErrorCode.BusinessError, "Unknown or inactive leave type");

    if (type.requiresAttachment && !req.attachment?.base64Data) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `${type.name} requires a document (e.g. medical certificate)`);
    }

    // Monthly CL quota (enforced at apply): a teacher may apply only N CLs per month.
    if (type.countsVsQuota) {
      const config = await this.ensureConfig(schoolId);
      const { first, last, month } = monthBounds(req.fromDate);
      const used = await DB.query(
        singleLineString`select count(1)::int as n from leave_application
          where school_id = $1 and employee_id = $2 and lower(leave_type_code) = lower($3)
            and status in ('pending', 'approved') and from_date >= $4 and from_date <= $5`,
        [schoolId, employeeId, type.code, first, last],
      );
      if (used[0].n >= config.clPerMonth) {
        throw new BusinessErrorResult(
          ErrorCode.BusinessError,
          `Only ${config.clPerMonth} ${type.name}(s) allowed in ${month}. Use another leave type for additional days.`,
        );
      }
    }

    const workingDays = await workingDaysBetween(schoolId, req.fromDate, req.toDate);
    const id = generateShortUuid(12);
    const now = new Date();
    await DB.query(
      singleLineString`insert into leave_application
        (uuid, school_id, employee_id, leave_type_code, from_date, to_date, working_days, reason, status, applied_at, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $9)`,
      [id, schoolId, employeeId, type.code, req.fromDate, req.toDate, workingDays, req.reason?.trim() || null, now, employeeId],
    );

    if (req.attachment?.base64Data && req.attachment?.mimeType) {
      const a = req.attachment;
      if (!(ATTACHMENT_ALLOWED_MIME as readonly string[]).includes(a.mimeType)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `Unsupported document type. Allowed: ${ATTACHMENT_ALLOWED_MIME.join(", ")}`);
      }
      if (Buffer.byteLength(a.base64Data, "base64") > ATTACHMENT_MAX_BYTES) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `Document too large (max ${Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB)`);
      }
      await fileStorageService.upload({
        fileName: a.fileName || `leave-${id}.doc`,
        mimeType: a.mimeType,
        base64Data: a.base64Data,
        entityType: FILE_ENTITY_TYPE,
        entityId: id,
        variant: "original",
        schoolId,
        userId: employeeId,
      });
    }

    await this.audit(schoolId, id, "apply", `${type.code} ${req.fromDate}..${req.toDate}`, null, "pending", employeeId);
    await this.notifyApplied(schoolId, id, employeeId, type.name, req.fromDate, req.toDate);
    return (await this.getApplication(schoolId, id))!;
  }

  // ── Queries ─────────────────────────────────────────────────────────────────
  async listApplications(
    schoolId: string,
    filters: { status?: string; employeeId?: string; from?: string; to?: string },
  ): Promise<LeaveApplicationView[]> {
    const conds: string[] = ["a.school_id = $1"];
    const params: any[] = [schoolId];
    if (filters.status) { params.push(filters.status); conds.push(`a.status = $${params.length}`); }
    if (filters.employeeId) { params.push(filters.employeeId); conds.push(`a.employee_id = $${params.length}`); }
    if (filters.from) { params.push(filters.from); conds.push(`a.to_date >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); conds.push(`a.from_date <= $${params.length}`); }
    const rows = await DB.query(
      singleLineString`select a.uuid, a.employee_id, e.name as employee_name, a.leave_type_code, t.name as leave_type_name,
          a.from_date::text as from_date, a.to_date::text as to_date, a.working_days, a.reason, a.status,
          a.applied_at::text as applied_at, a.decided_by, d.name as decided_by_name, a.decided_at::text as decided_at,
          a.decision_note, a.waived, a.waiver_reason,
          exists(select 1 from file_storage f where f.entity_type = '${FILE_ENTITY_TYPE}' and f.entity_id = a.uuid and f.school_id = a.school_id) as has_attachment
        from leave_application a
        left join employee e on e.uuid = a.employee_id and e.school_id = a.school_id
        left join leave_type t on lower(t.code) = lower(a.leave_type_code) and t.school_id = a.school_id
        left join employee d on d.uuid = a.decided_by and d.school_id = a.school_id
        where ${conds.join(" and ")}
        order by a.applied_at desc nulls last, a.created_at desc`,
      params,
    );
    return rows.map((r: any) => this.toView(r));
  }

  async getApplication(schoolId: string, id: string): Promise<LeaveApplicationView | null> {
    const rows = await this.listApplicationsRaw(schoolId, id);
    return rows.length ? this.toView(rows[0]) : null;
  }

  private async listApplicationsRaw(schoolId: string, id: string): Promise<any[]> {
    return DB.query(
      singleLineString`select a.uuid, a.employee_id, e.name as employee_name, a.leave_type_code, t.name as leave_type_name,
          a.from_date::text as from_date, a.to_date::text as to_date, a.working_days, a.reason, a.status,
          a.applied_at::text as applied_at, a.decided_by, d.name as decided_by_name, a.decided_at::text as decided_at,
          a.decision_note, a.waived, a.waiver_reason,
          exists(select 1 from file_storage f where f.entity_type = '${FILE_ENTITY_TYPE}' and f.entity_id = a.uuid and f.school_id = a.school_id) as has_attachment
        from leave_application a
        left join employee e on e.uuid = a.employee_id and e.school_id = a.school_id
        left join leave_type t on lower(t.code) = lower(a.leave_type_code) and t.school_id = a.school_id
        left join employee d on d.uuid = a.decided_by and d.school_id = a.school_id
        where a.school_id = $1 and a.uuid = $2`,
      [schoolId, id],
    );
  }

  private toView(r: any): LeaveApplicationView {
    return {
      uuid: r.uuid,
      employeeId: r.employeeId,
      employeeName: r.employeeName || null,
      leaveTypeCode: r.leaveTypeCode,
      leaveTypeName: r.leaveTypeName || null,
      fromDate: r.fromDate,
      toDate: r.toDate,
      workingDays: r.workingDays,
      reason: r.reason || null,
      status: r.status,
      appliedAt: r.appliedAt || null,
      decidedBy: r.decidedBy || null,
      decidedByName: r.decidedByName || null,
      decidedAt: r.decidedAt || null,
      decisionNote: r.decisionNote || null,
      waived: !!r.waived,
      waiverReason: r.waiverReason || null,
      hasAttachment: !!r.hasAttachment,
    };
  }

  // ── Decisions ────────────────────────────────────────────────────────────────
  private async findRaw(schoolId: string, id: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select uuid, employee_id, leave_type_code, from_date::text as from_date, to_date::text as to_date, status
        from leave_application where school_id = $1 and uuid = $2`,
      [schoolId, id],
    );
    return rows[0] || null;
  }

  async approve(schoolId: string, id: string, userId: string): Promise<LeaveApplicationView | null> {
    const app = await this.findRaw(schoolId, id);
    if (!app) return null;
    if (app.status !== "pending") throw new BusinessErrorResult(ErrorCode.BusinessError, `Cannot approve a ${app.status} application`);

    const type = await this.getType(schoolId, app.leaveTypeCode);
    const config = await this.ensureConfig(schoolId);

    // Per-day approval cap applies to quota-counting leave (CL): at most `dailyCap`
    // approved on any single date, school-wide.
    if (type?.countsVsQuota) {
      for (const date of datesInRange(app.fromDate, app.toDate)) {
        const cnt = await DB.query(
          singleLineString`select count(1)::int as n from leave_application
            where school_id = $1 and lower(leave_type_code) = lower($2) and status = 'approved'
              and uuid <> $3 and from_date <= $4 and to_date >= $4`,
          [schoolId, app.leaveTypeCode, id, date],
        );
        if (cnt[0].n >= config.dailyCap) {
          throw new BusinessErrorResult(
            ErrorCode.BusinessError,
            `Daily cap reached: ${config.dailyCap} ${type.name}(s) already approved for ${date}`,
          );
        }
      }
    }

    const now = new Date();
    await DB.query(
      singleLineString`update leave_application set status = 'approved', decided_by = $1, decided_at = $2, updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'pending'`,
      [userId, now, id, schoolId],
    );
    await this.audit(schoolId, id, "approve", null, "pending", "approved", userId);
    await this.notifyDecision(schoolId, id, app.employeeId, NOTIFY.APPROVED, "Leave approved", type?.name, app.fromDate, app.toDate);
    return this.getApplication(schoolId, id);
  }

  async reject(schoolId: string, id: string, note: string | undefined, userId: string): Promise<LeaveApplicationView | null> {
    const app = await this.findRaw(schoolId, id);
    if (!app) return null;
    if (app.status !== "pending") throw new BusinessErrorResult(ErrorCode.BusinessError, `Cannot reject a ${app.status} application`);
    const now = new Date();
    await DB.query(
      singleLineString`update leave_application set status = 'rejected', decided_by = $1, decided_at = $2, decision_note = $3, updatedby_userid = $1, updated_at = $2
        where uuid = $4 and school_id = $5 and status = 'pending'`,
      [userId, now, note?.slice(0, 256) || null, id, schoolId],
    );
    await this.audit(schoolId, id, "reject", note || null, "pending", "rejected", userId);
    const type = await this.getType(schoolId, app.leaveTypeCode);
    await this.notifyDecision(schoolId, id, app.employeeId, NOTIFY.REJECTED, "Leave rejected", type?.name, app.fromDate, app.toDate);
    return this.getApplication(schoolId, id);
  }

  // Applicant cancels their own pending, or an approved leave that has not started.
  async cancel(schoolId: string, id: string, employeeId: string, todayIso: string): Promise<LeaveApplicationView | null> {
    const app = await this.findRaw(schoolId, id);
    if (!app) return null;
    if (app.employeeId !== employeeId) throw new BusinessErrorResult(ErrorCode.BusinessError, "You can only cancel your own leave");
    if (app.status === "cancelled") return this.getApplication(schoolId, id);
    if (app.status === "rejected") throw new BusinessErrorResult(ErrorCode.BusinessError, "A rejected application cannot be cancelled");
    if (app.status === "approved" && app.fromDate <= todayIso) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "An approved leave that has already started cannot be cancelled");
    }
    const now = new Date();
    await DB.query(
      singleLineString`update leave_application set status = 'cancelled', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4`,
      [employeeId, now, id, schoolId],
    );
    await this.audit(schoolId, id, "cancel", null, app.status, "cancelled", employeeId);
    return this.getApplication(schoolId, id);
  }

  // ── Balance ─────────────────────────────────────────────────────────────────
  async balance(schoolId: string, employeeId: string, month: string): Promise<LeaveBalanceView> {
    const config = await this.ensureConfig(schoolId);
    const first = `${month}-01`;
    const { last } = monthBounds(first);
    const rows = await DB.query(
      singleLineString`select t.counts_vs_quota, a.status, count(1)::int as n
        from leave_application a
        left join leave_type t on lower(t.code) = lower(a.leave_type_code) and t.school_id = a.school_id
        where a.school_id = $1 and a.employee_id = $2 and a.from_date >= $3 and a.from_date <= $4
        group by t.counts_vs_quota, a.status`,
      [schoolId, employeeId, first, last],
    );
    let clUsed = 0, pending = 0, approved = 0, rejected = 0;
    for (const r of rows) {
      if (r.status === "pending") pending += r.n;
      else if (r.status === "approved") approved += r.n;
      else if (r.status === "rejected") rejected += r.n;
      if (r.countsVsQuota && (r.status === "pending" || r.status === "approved")) clUsed += r.n;
    }
    return {
      employeeId,
      month,
      clPerMonth: config.clPerMonth,
      clUsed,
      clRemaining: Math.max(0, config.clPerMonth - clUsed),
      pending,
      approved,
      rejected,
    };
  }

  // ── Attachment ────────────────────────────────────────────────────────────────
  async getAttachment(schoolId: string, id: string): Promise<{ data: string; mimeType: string; fileName: string } | null> {
    const files = await DB.query(
      singleLineString`select uuid from file_storage where entity_type = $1 and entity_id = $2 and school_id = $3 order by created_at desc limit 1`,
      [FILE_ENTITY_TYPE, id, schoolId],
    );
    if (!files.length) return null;
    const stored = await fileStorageService.getWithData(files[0].uuid, schoolId);
    return stored ? { data: stored.data, mimeType: stored.mimeType, fileName: stored.fileName } : null;
  }

  // ── Audit ──────────────────────────────────────────────────────────────────
  async getAudit(schoolId: string, applicationId: string): Promise<LeaveAuditRow[]> {
    const rows = await DB.query(
      singleLineString`select a.uuid, a.application_id, a.action, a.detail, a.from_status, a.to_status, a.changedby_userid,
          e.name as changedby_name, a.changed_at::text as changed_at
        from leave_audit a
        left join employee e on e.uuid = a.changedby_userid and e.school_id = a.school_id
        where a.school_id = $1 and a.application_id = $2 order by a.changed_at desc`,
      [schoolId, applicationId],
    );
    return rows.map((r: any) => ({
      uuid: r.uuid,
      applicationId: r.applicationId,
      action: r.action,
      detail: r.detail || null,
      fromStatus: r.fromStatus || null,
      toStatus: r.toStatus || null,
      changedbyUserid: r.changedbyUserid || null,
      changedbyName: r.changedbyName || null,
      changedAt: r.changedAt || null,
    }));
  }

  private async audit(
    schoolId: string,
    applicationId: string,
    action: string,
    detail: string | null,
    fromStatus: string | null,
    toStatus: string | null,
    userId: string,
  ): Promise<void> {
    await DB.query(
      singleLineString`insert into leave_audit (uuid, school_id, application_id, action, detail, from_status, to_status, changedby_userid, changed_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [generateShortUuid(12), schoolId, applicationId, action, detail ? detail.slice(0, 256) : null, fromStatus, toStatus, userId, new Date()],
    );
  }

  // ── Notifications (fire-and-forget, in-app inbox) ─────────────────────────────
  private async schoolCode(schoolId: string): Promise<string | null> {
    const rows = await DB.query(singleLineString`select code from school where uuid = $1`, [schoolId]);
    return rows.length ? rows[0].code : null;
  }

  private async employeeName(schoolId: string, employeeId: string): Promise<string> {
    const e = await findEmployee(schoolId, employeeId);
    return e?.name || "A colleague";
  }

  private async notifyApplied(schoolId: string, id: string, employeeId: string, typeName: string, from: string, to: string): Promise<void> {
    const code = await this.schoolCode(schoolId);
    if (!code) return;
    const approvers = await approverEmployeeIds(schoolId);
    const name = await this.employeeName(schoolId, employeeId);
    const range = from === to ? from : `${from} to ${to}`;
    await notifyInApp(code, "employee", approvers, NOTIFY.APPLIED, "Leave request", `${name} applied for ${typeName} (${range})`, { entityType: FILE_ENTITY_TYPE, entityId: id });
  }

  private async notifyDecision(schoolId: string, id: string, employeeId: string, key: string, title: string, typeName: string | undefined, from: string, to: string): Promise<void> {
    const code = await this.schoolCode(schoolId);
    if (!code) return;
    const range = from === to ? from : `${from} to ${to}`;
    await notifyInApp(code, "employee", [employeeId], key, title, `Your ${typeName || "leave"} (${range}) was ${title.toLowerCase().includes("approv") ? "approved" : "rejected"}`, { entityType: FILE_ENTITY_TYPE, entityId: id });
  }
}

export const leaveService = new LeaveService();
