import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guard } from '../auth/authz';
import { TIMETABLE_ACTIONS } from './timetable-actions';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { wingService } from './wing-service';
import { timetableService } from './timetable-service';
import { CreateWingRequest, UpdateWingRequest } from './timetable-interfaces';

// Validate that every classId exists for the school. Returns an error message or null.
async function validateClassIds(classIds: string[] | undefined, schoolId: string): Promise<string | null> {
  if (!classIds) return null;
  if (!Array.isArray(classIds)) return 'classIds must be an array';
  for (const classId of [...new Set(classIds)]) {
    if (!(await timetableService.classExists(classId, schoolId))) return `Invalid classId: ${classId}`;
  }
  return null;
}

class WingHandler {
  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      const wings = await wingService.list(ctx.schoolId, qp.academicYearId);
      ResponseBuilder.ok({ wings }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const result = await wingService.getById(id, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Wing not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateWingRequest>(event, callback);
      if (!body) return;
      if (!body.academicYearId || !body.name) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId and name are required', callback); return;
      }
      const classErr = await validateClassIds(body.classIds, ctx.schoolId);
      if (classErr) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, classErr, callback); return; }
      const result = await wingService.create(body, ctx.schoolId, ctx.userId);
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
      const body = parseBody<UpdateWingRequest>(event, callback);
      if (!body) return;
      const classErr = await validateClassIds(body.classIds, ctx.schoolId);
      if (classErr) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, classErr, callback); return; }
      const result = await wingService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Wing not found', callback); return; }
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
      const existing = await wingService.getById(id, ctx.schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Wing not found', callback); return; }
      await wingService.delete(id, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ message: 'Wing deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new WingHandler();
export const list = guard(TIMETABLE_ACTIONS['wing-handler.list'], handler.list);
export const getById = guard(TIMETABLE_ACTIONS['wing-handler.getById'], handler.getById);
export const create = guard(TIMETABLE_ACTIONS['wing-handler.create'], handler.create);
export const update = guard(TIMETABLE_ACTIONS['wing-handler.update'], handler.update);
export const remove = guard(TIMETABLE_ACTIONS['wing-handler.remove'], handler.remove);
