import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { reconcileMonth } from "./leave-reconcile";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const MONTH_RE = /^\d{4}-\d{2}$/;

// Phase 3: the escalating deduction ladder, in DAYS OF PAY (no salary in the system —
// payroll converts to ₹ offline). The nth counted absence in a month costs n days:
// ladder = k*(k+1)/2 for k counted days. Plain LWP (= k) is the automatic figure; the
// ladder is the Director-confirmed figure chosen at finalize. See DESIGN §6/§7.

function ladderDays(k: number): number {
  return (k * (k + 1)) / 2;
}
function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface DeductionSummary {
  employeeId: string;
  employeeName?: string | null;
  month: string;
  paidDays: number;
  clUsed: number;
  authorizedUnpaidAbsences: number; // approved LWP
  unauthorizedAbsences: number;     // absent, no leave
  countedAbsences: number;          // = authorized-unpaid + unauthorized (ladder input)
  plainLwpDays: number;
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

  // Provisional (computed) summary for one employee — used by /me and the god drill-down.
  // Returns the finalized figures if a finalized run exists, else a live computation.
  async employeeSummary(schoolId: string, employeeId: string, month: string): Promise<DeductionSummary> {
    const { year, m } = this.parseMonth(month);
    const rec = await reconcileMonth(schoolId, employeeId, year, m, istToday());
    const k = rec.countedDates.length;
    const plain = k;
    const ladder = ladderDays(k);
    const cl = await this.clUsed(schoolId, employeeId, month);
    const paidDays = rec.counts.present + rec.counts.paidLeave;

    const run = await DB.query(
      singleLineString`select applied_deduction_days, plain_lwp_days, ladder_deduction_days, status
        from leave_deduction_run where school_id = $1 and employee_id = $2 and run_year = $3 and run_month = $4`,
      [schoolId, employeeId, year, m],
    );
    const finalized = run.length && run[0].status === "finalized";

    return {
      employeeId,
      month,
      paidDays,
      clUsed: cl,
      authorizedUnpaidAbsences: rec.counts.countedAbsence - rec.counts.unauthorized,
      unauthorizedAbsences: rec.counts.unauthorized,
      countedAbsences: k,
      plainLwpDays: finalized ? run[0].plainLwpDays : plain,
      ladderDeductionDays: finalized ? run[0].ladderDeductionDays : ladder,
      appliedDeductionDays: finalized ? run[0].appliedDeductionDays : plain,
      status: finalized ? "final" : "provisional",
    };
  }

  // Generate/refresh DRAFT runs for the month across all active employees with a
  // counted absence. Idempotent: re-running recomputes drafts; finalized runs are left.
  async run(schoolId: string, month: string, userId: string): Promise<{ drafted: number }> {
    const { year, m } = this.parseMonth(month);
    const employees = await DB.query(
      singleLineString`select uuid, name from employee where school_id = $1 and status = 'active'`,
      [schoolId],
    );
    const now = new Date();
    let drafted = 0;
    for (const e of employees) {
      const rec = await reconcileMonth(schoolId, e.uuid, year, m, istToday());
      const k = rec.countedDates.length;
      if (k === 0) continue;
      const existing = await DB.query(
        singleLineString`select uuid, status from leave_deduction_run where school_id = $1 and employee_id = $2 and run_year = $3 and run_month = $4`,
        [schoolId, e.uuid, year, m],
      );
      if (existing.length && existing[0].status === "finalized") continue; // don't clobber a finalized run
      const cl = await this.clUsed(schoolId, e.uuid, month);
      const paidDays = rec.counts.present + rec.counts.paidLeave;
      const plain = k;
      const ladder = ladderDays(k);
      if (existing.length) {
        await DB.query(
          singleLineString`update leave_deduction_run set paid_days = $1, cl_used = $2, authorized_unpaid_absences = $3,
            unauthorized_absences = $4, plain_lwp_days = $5, ladder_deduction_days = $6, applied_deduction_days = $7,
            generated_by = $8, generated_at = $9 where uuid = $10`,
          [paidDays, cl, rec.counts.countedAbsence - rec.counts.unauthorized, rec.counts.unauthorized, plain, ladder, plain, userId, now, existing[0].uuid],
        );
      } else {
        await DB.query(
          singleLineString`insert into leave_deduction_run
            (uuid, school_id, employee_id, run_year, run_month, paid_days, cl_used, authorized_unpaid_absences, unauthorized_absences,
             ladder_deduction_days, plain_lwp_days, applied_deduction_days, status, generated_by, generated_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13, $14)`,
          [generateShortUuid(12), schoolId, e.uuid, year, m, paidDays, cl, rec.counts.countedAbsence - rec.counts.unauthorized,
            rec.counts.unauthorized, ladder, plain, plain, userId, now],
        );
      }
      drafted++;
    }
    return { drafted };
  }

  // Finalize one run. applyLadder=true sets the escalated figure as applied; else plain LWP.
  async finalize(schoolId: string, runId: string, applyLadder: boolean, userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select uuid, plain_lwp_days, ladder_deduction_days, status from leave_deduction_run where school_id = $1 and uuid = $2`,
      [schoolId, runId],
    );
    if (!rows.length) return false;
    if (rows[0].status === "finalized") throw new BusinessErrorResult(ErrorCode.BusinessError, "Run is already finalized");
    const applied = applyLadder ? rows[0].ladderDeductionDays : rows[0].plainLwpDays;
    await DB.query(
      singleLineString`update leave_deduction_run set applied_deduction_days = $1, status = 'finalized', confirmed_by = $2, confirmed_at = $3 where uuid = $4`,
      [applied, userId, new Date(), runId],
    );
    return true;
  }

  async listRuns(schoolId: string, month: string): Promise<any[]> {
    const { year, m } = this.parseMonth(month);
    const rows = await DB.query(
      singleLineString`select r.uuid, r.employee_id, e.name as employee_name, r.paid_days, r.cl_used,
          r.authorized_unpaid_absences, r.unauthorized_absences, r.plain_lwp_days, r.ladder_deduction_days,
          r.applied_deduction_days, r.status
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
      ladderDeductionDays: r.ladderDeductionDays,
      appliedDeductionDays: r.appliedDeductionDays,
      status: r.status,
    }));
  }
}

export const leaveDeductionService = new LeaveDeductionService();
