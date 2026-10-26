import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guard } from '../auth/authz';
import { staffAttendanceService } from './staff-attendance-service';
import { regularizationService } from './regularization-service';
import { STAFF_ATTENDANCE_ACTIONS } from './staff-attendance-actions';
import { resolveEmployee, parseBody, requireParam, istMonthRange } from './handler-util';

// Employee self-service: see MY attendance (late or not) + file / cancel own regularizations.
// Scoped entirely to the logged-in employee (token), so no cross-employee access.
class StaffAttendanceMeHandler {
  myAttendance = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const me = resolveEmployee(event, callback);
      if (!me) return;
      const q = event.queryStringParameters || {};
      const range = q.from && q.to ? { from: q.from, to: q.to } : istMonthRange();
      const res = await staffAttendanceService.employeeDays(me.schoolId, me.employeeId, range.from, range.to);
      if (!res) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Employee not found', callback); return; }
      ResponseBuilder.ok(res, callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  myRegularizations = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const me = resolveEmployee(event, callback);
      if (!me) return;
      ResponseBuilder.ok(await regularizationService.myList(me.schoolId, me.employeeId), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  applyRegularization = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const me = resolveEmployee(event, callback);
      if (!me) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await regularizationService.apply(me.schoolId, me.employeeId, body), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  cancelRegularization = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const me = resolveEmployee(event, callback);
      if (!me) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      ResponseBuilder.ok(await regularizationService.cancel(me.schoolId, me.employeeId, id), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };
}

const h = new StaffAttendanceMeHandler();
const g = (ref: string, fn: any) => guard(STAFF_ATTENDANCE_ACTIONS[ref], fn);

export const myAttendance = g('staff-attendance-me-handler.myAttendance', h.myAttendance);
export const myRegularizations = g('staff-attendance-me-handler.myRegularizations', h.myRegularizations);
export const applyRegularization = g('staff-attendance-me-handler.applyRegularization', h.applyRegularization);
export const cancelRegularization = g('staff-attendance-me-handler.cancelRegularization', h.cancelRegularization);
