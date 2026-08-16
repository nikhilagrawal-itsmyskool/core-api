import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guard } from '../auth/authz';
import { TIMETABLE_ACTIONS } from './timetable-actions';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { classSubjectService } from './class-subject-service';
import { timetableService } from './timetable-service';
import { CreateClassSubjectRequest, UpdateClassSubjectRequest } from './timetable-interfaces';

class ClassSubjectHandler {
  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      const classSubjects = await classSubjectService.list(ctx.schoolId, qp.classId, qp.academicYearId);
      ResponseBuilder.ok({ classSubjects }, callback);
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
      const result = await classSubjectService.getById(id, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Class subject not found', callback); return; }
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
      const body = parseBody<CreateClassSubjectRequest>(event, callback);
      if (!body) return;
      if (!body.academicYearId || !body.classId || !body.subjectId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId, classId and subjectId are required', callback); return;
      }
      if (!Number.isInteger(body.periodsPerWeek) || body.periodsPerWeek < 1) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'periodsPerWeek must be a positive integer', callback); return;
      }
      if (!(await timetableService.classExists(body.classId, ctx.schoolId))) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid classId', callback); return;
      }
      if (!(await timetableService.subjectExists(body.subjectId, ctx.schoolId))) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid subjectId', callback); return;
      }
      const result = await classSubjectService.create(body, ctx.schoolId, ctx.userId);
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
      const body = parseBody<UpdateClassSubjectRequest>(event, callback);
      if (!body) return;
      if (body.periodsPerWeek !== undefined && (!Number.isInteger(body.periodsPerWeek) || body.periodsPerWeek < 1)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'periodsPerWeek must be a positive integer', callback); return;
      }
      const result = await classSubjectService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Class subject not found', callback); return; }
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
      const existing = await classSubjectService.getById(id, ctx.schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Class subject not found', callback); return; }
      await classSubjectService.delete(id, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ message: 'Class subject deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ClassSubjectHandler();
export const list = guard(TIMETABLE_ACTIONS['class-subject-handler.list'], handler.list);
export const getById = guard(TIMETABLE_ACTIONS['class-subject-handler.getById'], handler.getById);
export const create = guard(TIMETABLE_ACTIONS['class-subject-handler.create'], handler.create);
export const update = guard(TIMETABLE_ACTIONS['class-subject-handler.update'], handler.update);
export const remove = guard(TIMETABLE_ACTIONS['class-subject-handler.remove'], handler.remove);
