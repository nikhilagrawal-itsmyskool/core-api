import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guard } from '../auth/authz';
import { FEE_ACTIONS } from './fees-actions';
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

  public multi = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const results = await concessionService.multiConcession(ctx.schoolId, event.queryStringParameters?.academicYearId);
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

  // Mid-year concession change (stop/switch a scheme from a cycle). POST body carries dryRun for preview.
  public changeConcession = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      const result = await concessionService.changeConcession(ctx.schoolId, body, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public timeline = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const studentId = requireParam(event, 'id', callback);
      if (!studentId) return;
      const academicYearId = event.queryStringParameters?.academicYearId;
      if (!academicYearId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId is required', callback); return; }
      const result = await concessionService.concessionTimeline(ctx.schoolId, studentId, academicYearId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // School-wide concession change log (audit trail). Query: academicYearId?, from?, to?, limit?
  public auditLog = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      const results = await concessionService.auditLog(ctx.schoolId, {
        academicYearId: q.academicYearId, from: q.from, to: q.to,
        limit: q.limit ? Number(q.limit) : undefined,
      });
      ResponseBuilder.ok(results, callback);
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
export const create = guard(FEE_ACTIONS['fees-concession-handler.create'], handler.create);
export const update = guard(FEE_ACTIONS['fees-concession-handler.update'], handler.update);
export const remove = guard(FEE_ACTIONS['fees-concession-handler.remove'], handler.remove);
export const list = guard(FEE_ACTIONS['fees-concession-handler.list'], handler.list);
export const multi = guard(FEE_ACTIONS['fees-concession-handler.multi'], handler.multi);
export const listStudents = guard(FEE_ACTIONS['fees-concession-handler.listStudents'], handler.listStudents);
export const addStudents = guard(FEE_ACTIONS['fees-concession-handler.addStudents'], handler.addStudents);
export const removeStudent = guard(FEE_ACTIONS['fees-concession-handler.removeStudent'], handler.removeStudent);
export const changeConcession = guard(FEE_ACTIONS['fees-concession-handler.changeConcession'], handler.changeConcession);
export const timeline = guard(FEE_ACTIONS['fees-concession-handler.timeline'], handler.timeline);
export const auditLog = guard(FEE_ACTIONS['fees-concession-handler.auditLog'], handler.auditLog);
