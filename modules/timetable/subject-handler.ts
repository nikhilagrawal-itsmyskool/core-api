import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { subjectService } from './subject-service';
import { CreateSubjectRequest, UpdateSubjectRequest } from './timetable-interfaces';
import { SUBJECT_KIND_VALUES } from './timetable-constants';

class SubjectHandler {
  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const subjects = await subjectService.list(ctx.schoolId);
      ResponseBuilder.ok({ subjects }, callback);
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
      const subject = await subjectService.getById(id, ctx.schoolId);
      if (!subject) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Subject not found', callback); return; }
      ResponseBuilder.ok(subject, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateSubjectRequest>(event, callback);
      if (!body) return;
      if (!body.name || !body.name.trim()) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Name is required', callback); return; }
      if (!body.code || !body.code.trim()) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Code is required', callback); return; }
      if (!body.kind || !SUBJECT_KIND_VALUES.includes(body.kind)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `kind must be one of: ${SUBJECT_KIND_VALUES.join(', ')}`, callback); return;
      }
      const subject = await subjectService.create(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(subject, callback);
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
      const body = parseBody<UpdateSubjectRequest>(event, callback);
      if (!body) return;
      if (body.kind !== undefined && !SUBJECT_KIND_VALUES.includes(body.kind)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `kind must be one of: ${SUBJECT_KIND_VALUES.join(', ')}`, callback); return;
      }
      const subject = await subjectService.update(id, body, ctx.schoolId, ctx.userId);
      if (!subject) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Subject not found', callback); return; }
      ResponseBuilder.ok(subject, callback);
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
      const existing = await subjectService.getById(id, ctx.schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Subject not found', callback); return; }
      await subjectService.delete(id, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ message: 'Subject deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SubjectHandler();
export const list = handler.list;
export const getById = handler.getById;
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
