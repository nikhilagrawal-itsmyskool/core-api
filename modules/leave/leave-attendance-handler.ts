import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, requireApprover, parseBody, requireParam } from "./handler-util";
import { leaveAttendanceService } from "./leave-attendance-service";
import { importBiometric, ImportMapping } from "./leave-attendance-import";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Admin/office attendance surface. Reads use the school header; writes (mark/import/map)
// require an approver (god/admin).
class LeaveAttendanceHandler {
  // POST /leave/attendance/mark   { employeeId, date, status, firstIn?, lastOut?, note? }
  public mark = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireApprover(event, callback);
      if (!auth) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      if (!body.employeeId || !body.date || !body.status) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "employeeId, date, status are required", callback);
      }
      await leaveAttendanceService.mark(auth.schoolId, body.employeeId, body.date, body.status, {
        firstIn: body.firstIn, lastOut: body.lastOut, note: body.note, userId: auth.userId,
      });
      const [year, month] = body.date.split("-");
      const rec = await leaveAttendanceService.employeeMonth(auth.schoolId, body.employeeId, `${year}-${month}`, istToday());
      ResponseBuilder.ok(rec, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /leave/attendance/import  { fileName, base64Data, mapping, coverageFrom, coverageTo, inferAbsent? }
  public importFile = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireApprover(event, callback);
      if (!auth) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      if (!body.base64Data) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "base64Data is required", callback);
      const mapping: ImportMapping = body.mapping || {};
      if (!mapping.codeHeader || !mapping.dateHeader) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "mapping.codeHeader and mapping.dateHeader are required", callback);
      }
      if (!body.coverageFrom || !DATE_RE.test(body.coverageFrom) || !body.coverageTo || !DATE_RE.test(body.coverageTo)) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "coverageFrom and coverageTo (YYYY-MM-DD) are required", callback);
      }
      const buffer = Buffer.from(body.base64Data, "base64");
      const result = await importBiometric(auth.schoolId, buffer, {
        fileName: body.fileName, mapping, coverageFrom: body.coverageFrom, coverageTo: body.coverageTo,
        inferAbsent: body.inferAbsent, userId: auth.userId,
      });
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/attendance/map
  public listMap = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      ResponseBuilder.ok(await leaveAttendanceService.listMap(auth.schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /leave/attendance/map   { enrollCode, employeeId }
  public mapEnroll = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireApprover(event, callback);
      if (!auth) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      if (!body.enrollCode || !body.employeeId) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "enrollCode and employeeId are required", callback);
      }
      await leaveAttendanceService.mapEnroll(auth.schoolId, body.enrollCode, body.employeeId, auth.userId);
      ResponseBuilder.ok(await leaveAttendanceService.listMap(auth.schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/employees/{id}/attendance?month=YYYY-MM
  public employeeAttendance = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const q = event.queryStringParameters || {};
      const month = q.month && MONTH_RE.test(q.month) ? q.month : istToday().slice(0, 7);
      ResponseBuilder.ok(await leaveAttendanceService.employeeMonth(auth.schoolId, id, month, istToday()), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/day?date=YYYY-MM-DD
  public dayView = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const date = q.date && DATE_RE.test(q.date) ? q.date : istToday();
      ResponseBuilder.ok(await leaveAttendanceService.dayView(auth.schoolId, date), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new LeaveAttendanceHandler();
export const mark = h.mark;
export const importFile = h.importFile;
export const listMap = h.listMap;
export const mapEnroll = h.mapEnroll;
export const employeeAttendance = h.employeeAttendance;
export const dayView = h.dayView;
