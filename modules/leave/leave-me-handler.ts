import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveEmployee, parseBody, requireParam } from "./handler-util";
import { leaveService } from "./leave-service";
import { leaveAttendanceService } from "./leave-attendance-service";
import { leaveDeductionService } from "./leave-deduction-service";
import { ApplyLeaveRequest } from "./leave-interfaces";

const MONTH_RE = /^\d{4}-\d{2}$/;

// Today's date in IST (school-local) so the applicant's "today" matches the app's day.
function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Teacher / office-staff PWA surface (employee bearer token). Every action is scoped
// to the logged-in employee.
class LeaveMeHandler {
  // GET /leave/me/types
  public listTypes = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      ResponseBuilder.ok(await leaveService.listTypes(emp.schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/me/summary?month=YYYY-MM
  public summary = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const q = event.queryStringParameters || {};
      const month = q.month && MONTH_RE.test(q.month) ? q.month : istToday().slice(0, 7);
      ResponseBuilder.ok(await leaveService.balance(emp.schoolId, emp.employeeId, month), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/me/applications?status=&from=&to=
  public listApplications = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const q = event.queryStringParameters || {};
      const rows = await leaveService.listApplications(emp.schoolId, {
        employeeId: emp.employeeId,
        status: q.status || undefined,
        from: q.from || undefined,
        to: q.to || undefined,
      });
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /leave/me/applications  { leaveTypeCode, fromDate, toDate, reason?, attachment? }
  public apply = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const body = parseBody<ApplyLeaveRequest>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await leaveService.apply(emp.schoolId, emp.employeeId, body), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /leave/me/applications/{id}/cancel
  public cancel = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const app = await leaveService.cancel(emp.schoolId, id, emp.employeeId, istToday());
      if (!app) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Leave application not found", callback);
      ResponseBuilder.ok(app, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/me/attendance?month=YYYY-MM  (my reconciled day-by-day, holidays interleaved)
  public attendance = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const q = event.queryStringParameters || {};
      const month = q.month && MONTH_RE.test(q.month) ? q.month : istToday().slice(0, 7);
      ResponseBuilder.ok(await leaveAttendanceService.employeeMonth(emp.schoolId, emp.employeeId, month, istToday()), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/me/deductions?month=YYYY-MM  (my penalty; provisional until finalized)
  public deductions = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const q = event.queryStringParameters || {};
      const month = q.month && MONTH_RE.test(q.month) ? q.month : istToday().slice(0, 7);
      ResponseBuilder.ok(await leaveDeductionService.employeeSummary(emp.schoolId, emp.employeeId, month), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/me/applications/{id}/attachment
  public getAttachment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const app = await leaveService.getApplication(emp.schoolId, id);
      if (!app || app.employeeId !== emp.employeeId) {
        return ResponseBuilder.notFound(ErrorCode.InvalidId, "Leave application not found", callback);
      }
      const doc = await leaveService.getAttachment(emp.schoolId, id);
      if (!doc) return ResponseBuilder.notFound(ErrorCode.InvalidId, "No document on this application", callback);
      ResponseBuilder.ok({ mimeType: doc.mimeType, fileName: doc.fileName, dataUri: `data:${doc.mimeType};base64,${doc.data}` }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new LeaveMeHandler();
export const listTypes = h.listTypes;
export const summary = h.summary;
export const listApplications = h.listApplications;
export const apply = h.apply;
export const cancel = h.cancel;
export const attendance = h.attendance;
export const deductions = h.deductions;
export const getAttachment = h.getAttachment;
