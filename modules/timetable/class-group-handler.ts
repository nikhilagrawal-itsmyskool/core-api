import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { classGroupService } from './class-group-service';
import { timetableService } from './timetable-service';
import { CreateClassGroupRequest, UpdateClassGroupRequest } from './timetable-interfaces';

// Validate that every classId in the list exists for the school. Returns the first
// invalid id, or null when all are valid.
async function firstInvalidClass(classIds: string[], schoolId: string): Promise<string | null> {
  for (const classId of classIds) {
    if (!(await timetableService.classExists(classId, schoolId))) return classId;
  }
  return null;
}

class ClassGroupHandler {
  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      const groups = await classGroupService.list(ctx.schoolId, qp.academicYearId);
      ResponseBuilder.ok({ classGroups: groups }, callback);
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
      const group = await classGroupService.getById(id, ctx.schoolId);
      if (!group) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Class group not found', callback); return; }
      ResponseBuilder.ok(group, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateClassGroupRequest>(event, callback);
      if (!body) return;
      if (!body.academicYearId || !body.name || !body.name.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId and name are required', callback); return;
      }
      if (!Array.isArray(body.classIds) || body.classIds.length < 2) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'A class group needs at least 2 member classes', callback); return;
      }
      const invalid = await firstInvalidClass(body.classIds, ctx.schoolId);
      if (invalid) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid classId: ${invalid}`, callback); return;
      }
      const group = await classGroupService.create(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(group, callback);
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
      const body = parseBody<UpdateClassGroupRequest>(event, callback);
      if (!body) return;
      if (body.classIds !== undefined) {
        if (!Array.isArray(body.classIds) || body.classIds.length < 2) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'A class group needs at least 2 member classes', callback); return;
        }
        const invalid = await firstInvalidClass(body.classIds, ctx.schoolId);
        if (invalid) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid classId: ${invalid}`, callback); return;
        }
      }
      const group = await classGroupService.update(id, body, ctx.schoolId, ctx.userId);
      if (!group) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Class group not found', callback); return; }
      ResponseBuilder.ok(group, callback);
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
      const existing = await classGroupService.getById(id, ctx.schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Class group not found', callback); return; }
      await classGroupService.delete(id, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ message: 'Class group deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ClassGroupHandler();
export const list = handler.list;
export const getById = handler.getById;
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
