import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { penaltyService } from "./penalty-service";
import { leaveService } from "./leave-service";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const MONTH_RE = /^\d{4}-\d{2}$/;

// Deductions are in DAYS OF PAY (payroll converts to ₹ offline). Stage 2b: the monthly figure
// is computed from the SAME live staff-attendance pipeline + rules as the teacher's My Penalty
// (penaltyService.monthPenalty), so teacher view and god report/payroll always agree. The
// legacy employee_attendance_day / leave-reconcile read is retired (no longer imported here).
//
// Components per month:
//   plainLwpDays   = absence LOP = absent (no leave) + approved-unpaid-leave days (each 1).
//   halfDayLopDays = half-day short-hours days × halfDayLopWeight.
//   lateLopDays    = monthly late roll-up (floor(lateCount / lateLopEvery) × lateLopDays).
//   ladderDeductionDays = plainLwpDays + escalation on repeated UNAUTHORIZED spells (toggle).
// appliedDeductionDays (finalize) = (ladder ? ladderDeductionDays : plainLwpDays) + half + late.
//
// A "spell" is a run of consecutive working days marked `absent` (weekly-offs / holidays in
// between don't break it; any present / leave / regularized day does).
function unauthorizedPenalty(days: Array<{ status: string }>): number {
  let spells = 0;
  let inSpell = false;
  for (const d of days) {
    if (d.status === "absent") {
      if (!inSpell) { spells++; inSpell = true; }
    } else if (d.status === "weekly_off" || d.status === "holiday") {
      // gap that doesn't break a spell
    } else {
      inSpell = false;
    }
  }
  if (spells <= 1) return 0;
  return 1 + 2 * (spells - 2); // 2nd spell +1, each further spell +2
}

export interface DeductionSummary {
  employeeId: string;
  employeeName?: string | null;
  month: string;
  paidDays: number;
  clUsed: number;
  authorizedUnpaidAbsences: number; // approved LWP
  unauthorizedAbsences: number;     // absent, no leave
  countedAbsences: number;          // = authorized-unpaid + unauthorized (full days)
  plainLwpDays: number;
  halfDayLopDays: number;
  lateLopDays: number;
  ladderDeductionDays: number;
  appliedDeductionDays: number;
  status: "provisional" | "final";
}

class LeaveDeductionService {
  private parseMonth(month: string): { year: number; m: number } {
    if (!MONTH_RE.test(month)) throw new BusinessErrorResult(ErrorCode.BusinessError, "month must be YYYY-MM");
    const [y, m] = month.split("-").map((x) => parseInt(x, 10));
    return { year: y, m };
  }

  private async clUsed(schoolId: string, employeeId: string, month: string): Promise<number> {
    const first = `${month}-01`;
    const rows = await DB.query(
      singleLineString`select count(1)::int as n from leave_application a
        join leave_type t on lower(t.code) = lower(a.leave_type_code) and t.school_id = a.school_id
        where a.school_id = $1 and a.employee_id = $2 and t.counts_vs_quota = true
          and a.status = 'approved' and a.from_date >= $3 and a.from_date < ($3::date + interval '1 month')`,
      [schoolId, employeeId, first],
    );
    return rows[0].n;
  }

  // Provisional (computed) summary for one employee — /me penalty drill-down + god report.
  // Returns finalized figures if a finalized run exists, else a live computation.
  async employeeSummary(schoolId: string, employeeId: string, month: string): Promise<DeductionSummary> {
    const { year, m } = this.parseMonth(month);
    const p = await penaltyService.monthPenalty(schoolId, employeeId, month);
    const cfg = await leaveService.ensureConfig(schoolId);
    const ladderDeductionDays = Math.round((p.plainLwpDays + unauthorizedPenalty(p.days)) * 10) / 10;
    const base = cfg.unauthorizedLadder ? ladderDeductionDays : p.plainLwpDays;
    const provisionalApplied = Math.round((base + p.halfDayLopDays + p.lateLopDays) * 10) / 10;
    const cl = await this.clUsed(schoolId, employeeId, month);

    const run = await DB.query(
      singleLineString`select applied_deduction_days::float8 as applied_deduction_days, status
        from leave_deduction_run where school_id = $1 and employee_id = $2 and run_year = $3 and run_month = $4`,
      [schoolId, employeeId, year, m],
    );
    const finalized = run.length > 0 && run[0].status === "finalized";

    return {
      employeeId,
      employeeName: p.name,
      month,
      paidDays: p.paidDays,
      clUsed: cl,
      authorizedUnpaidAbsences: p.authorizedUnpaidAbsences,
      unauthorizedAbsences: p.unauthorizedAbsences,
      countedAbsences: p.countedAbsences,
      plainLwpDays: p.plainLwpDays,
      halfDayLopDays: p.halfDayLopDays,
      lateLopDays: p.lateLopDays,
      ladderDeductionDays,
      appliedDeductionDays: finalized ? Number(run[0].appliedDeductionDays) : provisionalApplied,
      status: finalized ? "final" : "provisional",
    };
  }

  // Generate/refresh DRAFT runs for the month across all active staff with something to deduct.
  // Idempotent: re-running recomputes drafts; finalized runs are left untouched.
  async run(schoolId: string, month: string, userId: string): Promise<{ drafted: number }> {
    const { year, m } = this.parseMonth(month);
    const cfg = await leaveService.ensureConfig(schoolId);
    const employees = await DB.query(
      singleLineString`select uuid from employee where school_id = $1 and status = 'active'`,
      [schoolId],
    );
    const now = new Date();
    let drafted = 0;
    for (const e of employees) {
      const p = await penaltyService.monthPenalty(schoolId, e.uuid, month);
      if (p.plainLwpDays + p.halfDayLopDays + p.lateLopDays === 0) continue; // nothing to deduct
      const existing = await DB.query(
        singleLineString`select uuid, status from leave_deduction_run where school_id = $1 and employee_id = $2 and run_year = $3 and run_month = $4`,
        [schoolId, e.uuid, year, m],
      );
      if (existing.length && existing[0].status === "finalized") continue; // don't clobber a finalized run
      const cl = await this.clUsed(schoolId, e.uuid, month);
      const ladder = Math.round((p.plainLwpDays + unauthorizedPenalty(p.days)) * 10) / 10;
      const base = cfg.unauthorizedLadder ? ladder : p.plainLwpDays;
      const applied = Math.round((base + p.halfDayLopDays + p.lateLopDays) * 10) / 10;
      if (existing.length) {
        await DB.query(
          singleLineString`update leave_deduction_run set paid_days = $1, cl_used = $2, authorized_unpaid_absences = $3,
            unauthorized_absences = $4, plain_lwp_days = $5, ladder_deduction_days = $6, late_lop_days = $7, half_day_lop_days = $8,
            applied_deduction_days = $9, generated_by = $10, generated_at = $11 where uuid = $12`,
          [p.paidDays, cl, p.authorizedUnpaidAbsences, p.unauthorizedAbsences, p.plainLwpDays, ladder, p.lateLopDays, p.halfDayLopDays, applied, userId, now, existing[0].uuid],
        );
      } else {
        await DB.query(
          singleLineString`insert into leave_deduction_run
            (uuid, school_id, employee_id, run_year, run_month, paid_days, cl_used, authorized_unpaid_absences, unauthorized_absences,
             ladder_deduction_days, plain_lwp_days, late_lop_days, half_day_lop_days, applied_deduction_days, status, generated_by, generated_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'draft', $15, $16)`,
          [generateShortUuid(12), schoolId, e.uuid, year, m, p.paidDays, cl, p.authorizedUnpaidAbsences, p.unauthorizedAbsences,
            ladder, p.plainLwpDays, p.lateLopDays, p.halfDayLopDays, applied, userId, now],
        );
      }
      drafted++;
    }
    return { drafted };
  }

  // Finalize one run. applyLadder=true applies the escalated absence figure; else plain LWP.
  // Half-day + late components are always included.
  async finalize(schoolId: string, runId: string, applyLadder: boolean, userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select uuid, plain_lwp_days::float8 as plain_lwp_days, ladder_deduction_days::float8 as ladder_deduction_days,
          coalesce(late_lop_days,0)::float8 as late_lop_days, coalesce(half_day_lop_days,0)::float8 as half_day_lop_days, status
        from leave_deduction_run where school_id = $1 and uuid = $2`,
      [schoolId, runId],
    );
    if (!rows.length) return false;
    if (rows[0].status === "finalized") throw new BusinessErrorResult(ErrorCode.BusinessError, "Run is already finalized");
    const base = applyLadder ? Number(rows[0].ladderDeductionDays) : Number(rows[0].plainLwpDays);
    const applied = Math.round((base + Number(rows[0].lateLopDays) + Number(rows[0].halfDayLopDays)) * 10) / 10;
    await DB.query(
      singleLineString`update leave_deduction_run set applied_deduction_days = $1, status = 'finalized', confirmed_by = $2, confirmed_at = $3 where uuid = $4`,
      [applied, userId, new Date(), runId],
    );
    return true;
  }

  async listRuns(schoolId: string, month: string): Promise<any[]> {
    const { year, m } = this.parseMonth(month);
    const rows = await DB.query(
      singleLineString`select r.uuid, r.employee_id, e.name as employee_name, r.paid_days::float8 as paid_days, r.cl_used,
          r.authorized_unpaid_absences::float8 as authorized_unpaid_absences, r.unauthorized_absences::float8 as unauthorized_absences,
          r.plain_lwp_days::float8 as plain_lwp_days, r.ladder_deduction_days::float8 as ladder_deduction_days,
          coalesce(r.late_lop_days,0)::float8 as late_lop_days, coalesce(r.half_day_lop_days,0)::float8 as half_day_lop_days,
          r.applied_deduction_days::float8 as applied_deduction_days, r.status
        from leave_deduction_run r
        left join employee e on e.uuid = r.employee_id and e.school_id = r.school_id
        where r.school_id = $1 and r.run_year = $2 and r.run_month = $3
        order by r.applied_deduction_days desc, e.name`,
      [schoolId, year, m],
    );
    return rows.map((r: any) => ({
      uuid: r.uuid,
      employeeId: r.employeeId,
      employeeName: r.employeeName || null,
      month,
      paidDays: r.paidDays,
      clUsed: r.clUsed,
      authorizedUnpaidAbsences: r.authorizedUnpaidAbsences,
      unauthorizedAbsences: r.unauthorizedAbsences,
      plainLwpDays: r.plainLwpDays,
      halfDayLopDays: r.halfDayLopDays,
      lateLopDays: r.lateLopDays,
      ladderDeductionDays: r.ladderDeductionDays,
      appliedDeductionDays: r.appliedDeductionDays,
      status: r.status,
    }));
  }
}

export const leaveDeductionService = new LeaveDeductionService();
