import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { transportAssignmentService } from './transport-assignment-service';
import { CreateAssignmentRequest, UpdateAssignmentRequest } from './transport-interfaces';
import { DIRECTION_VALUES } from './transport-constants';

class TransportAssignmentHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateAssignmentRequest>(event, callback);
      if (!body) return;
      if (!body.academicYearId || !body.studentId || !body.routeId || !body.stopId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId, studentId, routeId and stopId are required', callback);
        return;
      }
      const result = await transportAssignmentService.create(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<UpdateAssignmentRequest>(event, callback);
      if (!body) return;
      const result = await transportAssignmentService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Assignment not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const deleted = await transportAssignmentService.delete(id, ctx.schoolId, ctx.userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Assignment not found', callback); return; }
      ResponseBuilder.ok({ message: 'Assignment removed successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      if (q.direction && !DIRECTION_VALUES.includes(q.direction as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `direction must be one of: ${DIRECTION_VALUES.join(', ')}`, callback);
        return;
      }
      const results = await transportAssignmentService.list(ctx.schoolId, {
        routeId: q.routeId, studentId: q.studentId, academicYearId: q.academicYearId, direction: q.direction,
      });
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /routes/{id}/students — the roster of assigned students for a route.
  public routeRoster = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const students = await transportAssignmentService.routeRoster(ctx.schoolId, id);
      ResponseBuilder.ok({ students }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /reports/student/{studentId}?academicYearId=
  public studentReport = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const studentId = requireParam(event, 'studentId', callback);
      if (!studentId) return;
      const q = event.queryStringParameters || {};
      const result = await transportAssignmentService.studentReport(ctx.schoolId, studentId, q.academicYearId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new TransportAssignmentHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const list = handler.list;
export const routeRoster = handler.routeRoster;
export const studentReport = handler.studentReport;
