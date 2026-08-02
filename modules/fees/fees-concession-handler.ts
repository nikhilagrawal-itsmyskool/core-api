import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './fees-util';
import {
  concessionService,
  CreateConcessionRequest,
  UpdateConcessionRequest,
  AddConcessionStudentsRequest,
} from './fees-concession-service';

class ConcessionHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateConcessionRequest>(event, callback);
      if (!body) return;
      const result = await concessionService.create(body, ctx.schoolId, ctx.userId);
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
      const body = parseBody<UpdateConcessionRequest>(event, callback);
      if (!body) return;
      const result = await concessionService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Concession not found', callback);
        return;
      }
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
      const result = await concessionService.remove(id, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Concession not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Concession deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const academicYearId = event.queryStringParameters?.academicYearId;
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';
      const results = await concessionService.list(ctx.schoolId, academicYearId, includeDeleted);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public listStudents = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';
      const results = await concessionService.listStudents(id, ctx.schoolId, includeDeleted);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public addStudents = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<AddConcessionStudentsRequest>(event, callback);
      if (!body) return;
      const result = await concessionService.addStudents(id, body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public removeStudent = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const studentId = requireParam(event, 'studentId', callback);
      if (!studentId) return;
      const result = await concessionService.removeStudent(id, studentId, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Concession student not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Concession student removed successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ConcessionHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const list = handler.list;
export const listStudents = handler.listStudents;
export const addStudents = handler.addStudents;
export const removeStudent = handler.removeStudent;
