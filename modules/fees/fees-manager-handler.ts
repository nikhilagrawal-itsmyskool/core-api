import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guard } from '../auth/authz';
import { FEE_ACTIONS } from './fees-actions';
import { resolveSchool } from './fees-util';
import { feesManagerService } from './fees-manager-service';

class FeesManagerHandler {
  // GET /fees/manager/summary — per-year dues + grand total + today's collection (fees vs transport)
  public summary = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      ResponseBuilder.ok(await feesManagerService.summary(ctx.schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /fees/manager/day?date=YYYY-MM-DD — a day's collection split + its receipt list
  public dayCollection = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      ResponseBuilder.ok(await feesManagerService.dayCollection(ctx.schoolId, event.queryStringParameters?.date), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /fees/manager/due-students?academicYearId=... — students who owe now, by class
  public dueStudents = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const academicYearId = event.queryStringParameters?.academicYearId;
      if (!academicYearId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId is required', callback); return; }
      ResponseBuilder.ok(await feesManagerService.dueStudents(ctx.schoolId, academicYearId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new FeesManagerHandler();
export const summary = guard(FEE_ACTIONS['fees-manager-handler.summary'], handler.summary);
export const dueStudents = guard(FEE_ACTIONS['fees-manager-handler.dueStudents'], handler.dueStudents);
export const dayCollection = guard(FEE_ACTIONS['fees-manager-handler.dayCollection'], handler.dayCollection);
