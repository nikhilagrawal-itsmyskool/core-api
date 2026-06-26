import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { teachingAssignmentService } from './teaching-assignment-service';
import { timetableService } from './timetable-service';
import { CreateTeachingAssignmentRequest, UpdateTeachingAssignmentRequest } from './timetable-interfaces';

class TeachingAssignmentHandler {
  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      const assignments = await teachingAssignmentService.list(ctx.schoolId, qp.classId, qp.teacherId, qp.academicYearId);
      ResponseBuilder.ok({ assignments }, callback);
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
      const result = await teachingAssignmentService.getById(id, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Teaching assignment not found', callback); return; }
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
      const body = parseBody<CreateTeachingAssignmentRequest>(event, callback);
      if (!body) return;
      if (!body.academicYearId || !body.classId || !body.subjectId || !body.teacherId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId, classId, subjectId and teacherId are required', callback); return;
      }
      if (body.periodShare !== undefined && body.periodShare !== null && (!Number.isInteger(body.periodShare) || body.periodShare < 1)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'periodShare must be a positive integer when provided', callback); return;
      }
      if (!(await timetableService.classExists(body.classId, ctx.schoolId))) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid classId', callback); return;
      }
      if (!(await timetableService.subjectExists(body.subjectId, ctx.schoolId))) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid subjectId', callback); return;
      }
      const result = await teachingAssignmentService.create(body, ctx.schoolId, ctx.userId);
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
      const body = parseBody<UpdateTeachingAssignmentRequest>(event, callback);
      if (!body) return;
      const result = await teachingAssignmentService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Teaching assignment not found', callback); return; }
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
      const existing = await teachingAssignmentService.getById(id, ctx.schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Teaching assignment not found', callback); return; }
      await teachingAssignmentService.delete(id, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ message: 'Teaching assignment deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new TeachingAssignmentHandler();
export const list = handler.list;
export const getById = handler.getById;
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
