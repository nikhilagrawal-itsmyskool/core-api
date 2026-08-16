import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guard } from '../auth/authz';
import { TIMETABLE_ACTIONS } from './timetable-actions';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { teacherConstraintService } from './teacher-constraint-service';
import { CreateTeacherConstraintRequest, UpdateTeacherConstraintRequest } from './timetable-interfaces';
import { CONSTRAINT_TYPE_VALUES, HARDNESS_VALUES } from './timetable-constants';

class TeacherConstraintHandler {
  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      const constraints = await teacherConstraintService.list(ctx.schoolId, qp.teacherId, qp.academicYearId);
      ResponseBuilder.ok({ constraints }, callback);
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
      const result = await teacherConstraintService.getById(id, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Constraint not found', callback); return; }
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
      const body = parseBody<CreateTeacherConstraintRequest>(event, callback);
      if (!body) return;
      if (!body.academicYearId || !body.teacherId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId and teacherId are required', callback); return;
      }
      if (!body.constraintType || !CONSTRAINT_TYPE_VALUES.includes(body.constraintType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `constraintType must be one of: ${CONSTRAINT_TYPE_VALUES.join(', ')}`, callback); return;
      }
      if (!body.hardness || !HARDNESS_VALUES.includes(body.hardness)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `hardness must be one of: ${HARDNESS_VALUES.join(', ')}`, callback); return;
      }
      const result = await teacherConstraintService.create(body, ctx.schoolId, ctx.userId);
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
      const body = parseBody<UpdateTeacherConstraintRequest>(event, callback);
      if (!body) return;
      if (body.hardness !== undefined && !HARDNESS_VALUES.includes(body.hardness)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `hardness must be one of: ${HARDNESS_VALUES.join(', ')}`, callback); return;
      }
      const result = await teacherConstraintService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Constraint not found', callback); return; }
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
      const existing = await teacherConstraintService.getById(id, ctx.schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Constraint not found', callback); return; }
      await teacherConstraintService.delete(id, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ message: 'Constraint deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new TeacherConstraintHandler();
export const list = guard(TIMETABLE_ACTIONS['teacher-constraint-handler.list'], handler.list);
export const getById = guard(TIMETABLE_ACTIONS['teacher-constraint-handler.getById'], handler.getById);
export const create = guard(TIMETABLE_ACTIONS['teacher-constraint-handler.create'], handler.create);
export const update = guard(TIMETABLE_ACTIONS['teacher-constraint-handler.update'], handler.update);
export const remove = guard(TIMETABLE_ACTIONS['teacher-constraint-handler.remove'], handler.remove);
