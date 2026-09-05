import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, requireApprover, parseBody, requireParam } from "./handler-util";
import { leaveDeductionService } from "./leave-deduction-service";

const MONTH_RE = /^\d{4}-\d{2}$/;
function thisMonth(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

// Deduction (payroll) surface. Generate/finalize require an approver; listing/per-employee
// reads use the school header.
class LeaveDeductionHandler {
  // POST /leave/deductions/run?month=YYYY-MM
  public run = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireApprover(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const month = q.month && MONTH_RE.test(q.month) ? q.month : thisMonth();
      const res = await leaveDeductionService.run(auth.schoolId, month, auth.userId);
      ResponseBuilder.ok({ month, ...res, runs: await leaveDeductionService.listRuns(auth.schoolId, month) }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/deductions?month=YYYY-MM
  public list = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const month = q.month && MONTH_RE.test(q.month) ? q.month : thisMonth();
      ResponseBuilder.ok(await leaveDeductionService.listRuns(auth.schoolId, month), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /leave/deductions/{id}/finalize   { applyLadder? }
  public finalize = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireApprover(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<{ applyLadder?: boolean }>(event, callback);
      if (!body) return;
      const ok = await leaveDeductionService.finalize(auth.schoolId, id, !!body.applyLadder, auth.userId);
      if (!ok) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Deduction run not found", callback);
      ResponseBuilder.ok({ ok: true }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/employees/{id}/deductions?month=YYYY-MM
  public employeeDeduction = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const q = event.queryStringParameters || {};
      const month = q.month && MONTH_RE.test(q.month) ? q.month : thisMonth();
      ResponseBuilder.ok(await leaveDeductionService.employeeSummary(auth.schoolId, id, month), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new LeaveDeductionHandler();
export const run = h.run;
export const list = h.list;
export const finalize = h.finalize;
export const employeeDeduction = h.employeeDeduction;
