import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guard } from '../auth/authz';
import { staffAttendanceService } from './staff-attendance-service';
import { regularizationService } from './regularization-service';
import { STAFF_ATTENDANCE_ACTIONS } from './staff-attendance-actions';
import { resolveSchool, parseBody, requireParam, istTodayIso, istMonthRange } from './handler-util';

// Oversight surface (admin + education-director): dashboards, reports, regularization queue.
class StaffAttendanceHandler {
  dayView = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const date = event.queryStringParameters?.date || istTodayIso();
      ResponseBuilder.ok(await staffAttendanceService.dayView(ctx.schoolId, date), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  report = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      const range = q.from && q.to ? { from: q.from, to: q.to } : istMonthRange();
      ResponseBuilder.ok(await staffAttendanceService.report(ctx.schoolId, range.from, range.to, q.employeeId), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  employeeAttendance = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const q = event.queryStringParameters || {};
      const range = q.from && q.to ? { from: q.from, to: q.to } : istMonthRange();
      const res = await staffAttendanceService.employeeDays(ctx.schoolId, id, range.from, range.to);
      if (!res) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Employee not found', callback); return; }
      ResponseBuilder.ok(res, callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  listRegularizations = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      ResponseBuilder.ok(await regularizationService.list(ctx.schoolId, { status: q.status, employeeId: q.employeeId }), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  approveRegularization = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<any>(event, callback) || {};
      ResponseBuilder.ok(await regularizationService.decide(ctx.schoolId, ctx.userId, id, true, body.comment), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  rejectRegularization = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<any>(event, callback) || {};
      ResponseBuilder.ok(await regularizationService.decide(ctx.schoolId, ctx.userId, id, false, body.comment), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };
}

const h = new StaffAttendanceHandler();
const g = (ref: string, fn: any) => guard(STAFF_ATTENDANCE_ACTIONS[ref], fn);

export const dayView = g('staff-attendance-handler.dayView', h.dayView);
export const report = g('staff-attendance-handler.report', h.report);
export const employeeAttendance = g('staff-attendance-handler.employeeAttendance', h.employeeAttendance);
export const listRegularizations = g('staff-attendance-handler.listRegularizations', h.listRegularizations);
export const approveRegularization = g('staff-attendance-handler.approveRegularization', h.approveRegularization);
export const rejectRegularization = g('staff-attendance-handler.rejectRegularization', h.rejectRegularization);
