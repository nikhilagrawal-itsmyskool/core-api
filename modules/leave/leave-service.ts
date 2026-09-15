import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService } from "../../shared/lib/file-storage";
import {
  findEmployee,
  approverEmployeeIds,
  workingDaysBetween,
  datesInRange,
  academicYearRange,
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
  ApproveResult,
  LeaveBalanceView,
  LeaveConfig,
  LeaveTypeView,
  LeaveAuditRow,
  LeaveCheck,
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

  // Update the per-school config knobs (currently the daily cap). god-gated in the handler.
  async updateConfig(schoolId: string, patch: { dailyCap?: number }, userId: string): Promise<LeaveConfig> {
    await this.ensureConfig(schoolId);
    if (patch.dailyCap != null && Number.isFinite(patch.dailyCap) && patch.dailyCap >= 0) {
      await DB.query(
        singleLineString`update leave_config set daily_cap = $1, updatedby_userid = $2, updated_at = $3 where school_id = $4 and status = 'active'`,
        [Math.floor(patch.dailyCap), userId, new Date(), schoolId],
      );
    }
    return this.ensureConfig(schoolId);
  }

  // ── Types (seeded on first use) ──────────────────────────────────────────────
  async ensureTypes(schoolId: string, userId = "system"): Promise<void> {
    // Insert any seed type whose code is missing (idempotent per-code) so new types like
    // Bereavement land on already-seeded schools too. Existing rows are never overwritten —
    // admins may have edited quota/paid, and a one-time sync script backfills annual_quota.
    const rows = await DB.query(
      singleLineString`select lower(code) as code from leave_type where school_id = $1 and status <> 'deleted'`,
      [schoolId],
    );
    const have = new Set(rows.map((r: any) => r.code));
    const now = new Date();
    for (const t of LEAVE_TYPE_SEED) {
      if (have.has(t.code.toLowerCase())) continue;
      await DB.query(
        singleLineString`insert into leave_type
          (uuid, school_id, code, name, paid, counts_vs_quota, requires_attachment, waivable, approver_role, sort_order, annual_quota, attachment_over_days, show_in_balance, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active', $14, $15)`,
        [generateShortUuid(12), schoolId, t.code, t.name, t.paid, t.countsVsQuota, t.requiresAttachment, t.waivable, t.approverRole, t.sortOrder, t.annualQuota, t.attachmentOverDays, t.showInBalance, userId, now],
      );
    }
  }

  async listTypes(schoolId: string): Promise<LeaveTypeView[]> {
    await this.ensureTypes(schoolId);
    const rows = await DB.query(
      singleLineString`select code, name, paid, counts_vs_quota, requires_attachment, waivable, approver_role, sort_order, status, annual_quota, attachment_over_days, show_in_balance
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
      annualQuota: r.annualQuota ?? null,
      attachmentOverDays: r.attachmentOverDays ?? null,
      showInBalance: r.showInBalance !== false,
    }));
  }

  // Edit a leave type's policy knobs (annual quota, conditional-attachment threshold, paid,
  // always-attachment). god-gated in the handler. Returns the refreshed type list.
  async updateType(schoolId: string, code: string, patch: any, userId: string): Promise<LeaveTypeView[]> {
    const t = await this.getType(schoolId, code);
    if (!t) throw new BusinessErrorResult(ErrorCode.BusinessError, "Unknown or inactive leave type");
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if ("annualQuota" in patch) { params.push(patch.annualQuota === null || patch.annualQuota === "" ? null : Math.max(0, Math.floor(Number(patch.annualQuota)))); sets.push(`annual_quota = $${i++}`); }
    if ("attachmentOverDays" in patch) { params.push(patch.attachmentOverDays === null || patch.attachmentOverDays === "" ? null : Math.max(0, Math.floor(Number(patch.attachmentOverDays)))); sets.push(`attachment_over_days = $${i++}`); }
    if ("requiresAttachment" in patch) { params.push(!!patch.requiresAttachment); sets.push(`requires_attachment = $${i++}`); }
    if ("showInBalance" in patch) { params.push(!!patch.showInBalance); sets.push(`show_in_balance = $${i++}`); }
    if ("paid" in patch && ["yes", "no", "discretionary"].includes(patch.paid)) { params.push(patch.paid); sets.push(`paid = $${i++}`); }
    if (!sets.length) return this.listTypes(schoolId);
    params.push(userId); sets.push(`updatedby_userid = $${i++}`);
    params.push(new Date()); sets.push(`updated_at = $${i++}`);
    params.push(schoolId); const sIdx = i++;
    params.push(t.code); const cIdx = i++;
    await DB.query(`update leave_type set ${sets.join(", ")} where school_id = $${sIdx} and lower(code) = lower($${cIdx})`, params);
    return this.listTypes(schoolId);
  }

  private async getType(schoolId: string, code: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select code, name, paid, counts_vs_quota, requires_attachment, waivable, annual_quota, attachment_over_days from leave_type
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

    // Half-day (single date only). first_half / second_half both cost 0.5 working days.
    const portion = req.dayPortion === "first_half" || req.dayPortion === "second_half" ? req.dayPortion : "full";
    const isHalf = portion !== "full";
    if (isHalf && req.fromDate !== req.toDate) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "A half day can only be applied for a single date");
    }
    const fullWorkingDays = await workingDaysBetween(schoolId, req.fromDate, req.toDate);
    if (isHalf && fullWorkingDays < 1) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "That date is a holiday or weekly off — no half day to apply");
    }
    const workingDays = isHalf ? 0.5 : fullWorkingDays;

    // Attachment: required when the type always needs one, or — when attachment_over_days
    // is set — only once the leave exceeds that many working days (e.g. an ML medical
    // certificate is required only for more than 2 consecutive days).
    const attachmentNeeded = type.attachmentOverDays != null
      ? workingDays > type.attachmentOverDays
      : !!type.requiresAttachment;
    if (attachmentNeeded && !req.attachment?.base64Data) {
      const extra = type.attachmentOverDays != null ? ` of more than ${type.attachmentOverDays} day(s)` : "";
      throw new BusinessErrorResult(ErrorCode.BusinessError, `${type.name}${extra} requires a document (e.g. medical certificate)`);
    }

    // Annual allocation (per academic year, lapses 31 Mar): the requested working days plus
    // any pending/approved of this type this year is compared to the type's quota (CL=8,
    // ML=4 by default). This is a SOFT limit — an over-quota request is still submitted (so
    // the Director can approve it as an exception) but the applicant is warned, and approval
    // will require an explicit override. See approve().
    const warnings: string[] = [];
    if (type.annualQuota != null) {
      const { start, end } = await academicYearRange(schoolId, req.fromDate);
      const usedRows = await DB.query(
        singleLineString`select coalesce(sum(working_days), 0)::float8 as n from leave_application
          where school_id = $1 and employee_id = $2 and lower(leave_type_code) = lower($3)
            and status in ('pending', 'approved') and from_date >= $4 and from_date <= $5`,
        [schoolId, employeeId, type.code, start, end],
      );
      const used = Number(usedRows[0].n) || 0;
      if (used + workingDays > type.annualQuota) {
        const left = Math.max(0, type.annualQuota - used);
        warnings.push(
          `${type.name} balance exceeded: ${type.annualQuota} day(s) a year — ${used} used, ${left} left, and this request is ${workingDays} day(s). It needs the Director's approval as an exception.`,
        );
      }
    }

    const id = generateShortUuid(12);
    const now = new Date();
    await DB.query(
      singleLineString`insert into leave_application
        (uuid, school_id, employee_id, leave_type_code, from_date, to_date, working_days, day_portion, reason, status, applied_at, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11, $10)`,
      [id, schoolId, employeeId, type.code, req.fromDate, req.toDate, workingDays, portion, req.reason?.trim() || null, now, employeeId],
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
    const view = (await this.getApplication(schoolId, id))!;
    return warnings.length ? { ...view, warnings } : view;
  }

  // ── Queries ─────────────────────────────────────────────────────────────────
  async listApplications(
    schoolId: string,
    filters: { status?: string; employeeId?: string; from?: string; to?: string },
    withEvaluation = false,
  ): Promise<LeaveApplicationView[]> {
    const conds: string[] = ["a.school_id = $1"];
    const params: any[] = [schoolId];
    if (filters.status) { params.push(filters.status); conds.push(`a.status = $${params.length}`); }
    if (filters.employeeId) { params.push(filters.employeeId); conds.push(`a.employee_id = $${params.length}`); }
    if (filters.from) { params.push(filters.from); conds.push(`a.to_date >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); conds.push(`a.from_date <= $${params.length}`); }
    const rows = await DB.query(
      singleLineString`select a.uuid, a.employee_id, e.name as employee_name, a.leave_type_code, t.name as leave_type_name,
          a.from_date::text as from_date, a.to_date::text as to_date, a.working_days::float8 as working_days, a.day_portion, a.reason, a.status,
          a.applied_at::text as applied_at, a.decided_by, d.name as decided_by_name, a.decided_at::text as decided_at,
          a.decision_note, a.waived, a.waiver_reason, a.overridden, a.override_reason,
          exists(select 1 from file_storage f where f.entity_type = '${FILE_ENTITY_TYPE}' and f.entity_id = a.uuid and f.school_id = a.school_id) as has_attachment
        from leave_application a
        left join employee e on e.uuid = a.employee_id and e.school_id = a.school_id
        left join leave_type t on lower(t.code) = lower(a.leave_type_code) and t.school_id = a.school_id
        left join employee d on d.uuid = a.decided_by and d.school_id = a.school_id
        where ${conds.join(" and ")}
        order by a.applied_at desc nulls last, a.created_at desc`,
      params,
    );
    const views = rows.map((r: any) => this.toView(r));
    if (withEvaluation) {
      for (const v of views) {
        if (v.status === "pending") v.evaluation = await this.evaluateApplication(schoolId, v.uuid);
      }
    }
    return views;
  }

  async getApplication(schoolId: string, id: string): Promise<LeaveApplicationView | null> {
    const rows = await this.listApplicationsRaw(schoolId, id);
    return rows.length ? this.toView(rows[0]) : null;
  }

  private async listApplicationsRaw(schoolId: string, id: string): Promise<any[]> {
    return DB.query(
      singleLineString`select a.uuid, a.employee_id, e.name as employee_name, a.leave_type_code, t.name as leave_type_name,
          a.from_date::text as from_date, a.to_date::text as to_date, a.working_days::float8 as working_days, a.day_portion, a.reason, a.status,
          a.applied_at::text as applied_at, a.decided_by, d.name as decided_by_name, a.decided_at::text as decided_at,
          a.decision_note, a.waived, a.waiver_reason, a.overridden, a.override_reason,
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
      workingDays: r.workingDays == null ? null : Number(r.workingDays),
      dayPortion: r.dayPortion || null,
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
      overridden: !!r.overridden,
      overrideReason: r.overrideReason || null,
    };
  }

  // ── Decisions ────────────────────────────────────────────────────────────────
  private async findRaw(schoolId: string, id: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select uuid, employee_id, leave_type_code, from_date::text as from_date, to_date::text as to_date, working_days, status
        from leave_application where school_id = $1 and uuid = $2`,
      [schoolId, id],
    );
    return rows[0] || null;
  }

  // Evaluate a pending application against the approval rules (daily CL cap, annual balance,
  // and whether it consumes any working day). Returns a per-check pass/fail list + an overall
  // `passes` flag. Powers the Approvals button colour + rule checklist, and is reused by
  // approve() to decide whether an exception confirmation is needed.
  async evaluateApplication(schoolId: string, id: string): Promise<{ checks: LeaveCheck[]; passes: boolean }> {
    const rows = await DB.query(
      singleLineString`select uuid, employee_id, leave_type_code, from_date::text as from_date, to_date::text as to_date,
          working_days::float8 as working_days, day_portion, status
        from leave_application where school_id = $1 and uuid = $2`,
      [schoolId, id],
    );
    if (!rows.length) return { checks: [], passes: true };
    const app = rows[0];
    const type = await this.getType(schoolId, app.leaveTypeCode);
    const config = await this.ensureConfig(schoolId);
    const reqDays = Number(app.workingDays) || 0;
    const checks: LeaveCheck[] = [];

    checks.push({
      key: "working_days", label: "Consumes working days", passed: reqDays > 0,
      detail: reqDays > 0 ? `${reqDays} working day(s)` : "Falls on a holiday or weekly-off — 0 working days will be consumed",
    });

    if (String(app.leaveTypeCode).toUpperCase() === "CL") {
      let hit: { date: string; n: number } | null = null;
      for (const date of datesInRange(app.fromDate, app.toDate)) {
        const cnt = await DB.query(
          singleLineString`select count(distinct employee_id)::int as n from leave_application
            where school_id = $1 and upper(leave_type_code) = 'CL' and status = 'approved'
              and uuid <> $2 and from_date <= $3 and to_date >= $3`,
          [schoolId, id, date],
        );
        if (cnt[0].n >= config.dailyCap) { hit = { date: date, n: cnt[0].n }; break; }
      }
      checks.push({
        key: "daily_cap", label: `Within the daily cap (${config.dailyCap}/day)`, passed: !hit,
        detail: hit ? `Daily cap: ${hit.n} staff already on Casual Leave on ${hit.date} (max ${config.dailyCap})` : `At most ${config.dailyCap} staff on Casual Leave per day`,
      });
    } else {
      checks.push({ key: "daily_cap", label: "Daily cap", passed: true, detail: "Applies to Casual Leave only" });
    }

    if (type?.annualQuota != null) {
      const { start, end } = await academicYearRange(schoolId, app.fromDate);
      const usedRows = await DB.query(
        singleLineString`select coalesce(sum(working_days), 0)::float8 as n from leave_application
          where school_id = $1 and employee_id = $2 and lower(leave_type_code) = lower($3)
            and status = 'approved' and uuid <> $4 and from_date >= $5 and from_date <= $6`,
        [schoolId, app.employeeId, app.leaveTypeCode, id, start, end],
      );
      const used = Number(usedRows[0].n) || 0;
      const within = used + reqDays <= type.annualQuota;
      checks.push({
        key: "annual_balance", label: `Within ${type.name} balance`, passed: within,
        detail: within
          ? `${used + reqDays} of ${type.annualQuota} day(s) used this year (incl. this request)`
          : `Over balance: ${type.annualQuota} day(s)/year — ${used} used + ${reqDays} = ${used + reqDays}`,
      });
    } else {
      checks.push({ key: "annual_balance", label: "Annual balance", passed: true, detail: "No annual limit for this type" });
    }

    return { checks, passes: checks.every((c) => c.passed) };
  }

  // Approve a pending application. The daily CL cap and the annual quota are SOFT limits:
  // if either would be breached and the approver has not confirmed an override, approval
  // pauses and returns { needsConfirmation, warnings } so the UI can ask "approve anyway?".
  // With opts.override the approval proceeds, the balance still goes down, and the override
  // (+ reason) is recorded. Returns null if the application does not exist.
  async approve(
    schoolId: string,
    id: string,
    userId: string,
    opts: { override?: boolean; overrideReason?: string } = {},
  ): Promise<ApproveResult | null> {
    const app = await this.findRaw(schoolId, id);
    if (!app) return null;
    if (app.status !== "pending") throw new BusinessErrorResult(ErrorCode.BusinessError, `Cannot approve a ${app.status} application`);

    const type = await this.getType(schoolId, app.leaveTypeCode);
    // Rule evaluation (daily cap / annual balance / 0-working-days) — failed checks become
    // the exception warnings.
    const evalRes = await this.evaluateApplication(schoolId, id);
    const warnings: string[] = evalRes.checks.filter((c) => !c.passed).map((c) => c.detail || c.label);

    if (warnings.length && !opts.override) {
      return { needsConfirmation: true, warnings };
    }

    const overridden = warnings.length > 0;
    const overrideReason = overridden ? (opts.overrideReason?.trim() || null) : null;
    const now = new Date();
    await DB.query(
      singleLineString`update leave_application set status = 'approved', decided_by = $1, decided_at = $2,
          overridden = $3, override_reason = $4, updatedby_userid = $1, updated_at = $2
        where uuid = $5 and school_id = $6 and status = 'pending'`,
      [userId, now, overridden, overrideReason, id, schoolId],
    );
    const auditDetail = overridden ? `OVERRIDE: ${warnings.join(" ")}${overrideReason ? ` — ${overrideReason}` : ""}`.slice(0, 256) : null;
    await this.audit(schoolId, id, overridden ? "override" : "approve", auditDetail, "pending", "approved", userId);
    await this.notifyDecision(schoolId, id, app.employeeId, NOTIFY.APPROVED, "Leave approved", type?.name, app.fromDate, app.toDate);
    const application = (await this.getApplication(schoolId, id))!;
    return { needsConfirmation: false, application, overridden };
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
  // Annual (academic-year) balance: remaining days for each quota type (CL, ML, …) plus
  // this year's pending/approved/rejected application counts. `month` anchors the year.
  async balance(schoolId: string, employeeId: string, month: string): Promise<LeaveBalanceView> {
    await this.ensureTypes(schoolId);
    const refDate = `${month}-01`;
    const { start, end } = await academicYearRange(schoolId, refDate);

    const types = await DB.query(
      singleLineString`select code, name, annual_quota from leave_type
        where school_id = $1 and status = 'active' and annual_quota is not null
          and (show_in_balance is null or show_in_balance = true)
        order by sort_order asc nulls last, code`,
      [schoolId],
    );
    const usage = await DB.query(
      singleLineString`select lower(leave_type_code) as code, coalesce(sum(working_days), 0)::float8 as used
        from leave_application
        where school_id = $1 and employee_id = $2 and status in ('pending', 'approved')
          and from_date >= $3 and from_date <= $4
        group by lower(leave_type_code)`,
      [schoolId, employeeId, start, end],
    );
    const usedByCode = new Map<string, number>(usage.map((r: any) => [r.code, Number(r.used) || 0]));
    const quotas = types.map((t: any) => {
      const used = usedByCode.get(String(t.code).toLowerCase()) || 0;
      return { code: t.code, name: t.name, quota: t.annualQuota, used, remaining: Math.max(0, t.annualQuota - used) };
    });

    const statusRows = await DB.query(
      singleLineString`select status, count(1)::int as n from leave_application
        where school_id = $1 and employee_id = $2 and from_date >= $3 and from_date <= $4
        group by status`,
      [schoolId, employeeId, start, end],
    );
    let pending = 0, approved = 0, rejected = 0;
    for (const r of statusRows) {
      if (r.status === "pending") pending += r.n;
      else if (r.status === "approved") approved += r.n;
      else if (r.status === "rejected") rejected += r.n;
    }

    return { employeeId, month, academicYearStart: start, academicYearEnd: end, quotas, pending, approved, rejected };
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
