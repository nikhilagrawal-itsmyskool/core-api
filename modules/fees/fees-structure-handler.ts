import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guard } from '../auth/authz';
import { FEE_ACTIONS } from './fees-actions';
import { resolveSchool, parseBody, requireParam } from './fees-util';
import {
  feeStructureService,
  CreateFeeStructureRequest,
  UpdateFeeStructureRequest,
  BulkApplyRequest,
  CopyFromClassRequest,
  UpsertStudentStructureRequest,
} from './fees-structure-service';

class FeeStructureHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateFeeStructureRequest>(event, callback);
      if (!body) return;
      const result = await feeStructureService.create(body, ctx.schoolId, ctx.userId);
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
      const body = parseBody<UpdateFeeStructureRequest>(event, callback);
      if (!body) return;
      const result = await feeStructureService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Fee structure not found', callback);
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
      const result = await feeStructureService.remove(id, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Fee structure not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Fee structure deleted successfully' }, callback);
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
      const classId = event.queryStringParameters?.classId;
      const feeHeadId = event.queryStringParameters?.feeHeadId;
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';
      const results = await feeStructureService.list(ctx.schoolId, academicYearId, classId, feeHeadId, includeDeleted);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public bulkApply = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<BulkApplyRequest>(event, callback);
      if (!body) return;
      const result = await feeStructureService.bulkApply(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public copyFromClass = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CopyFromClassRequest>(event, callback);
      if (!body) return;
      const result = await feeStructureService.copyFromClass(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public listStudent = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const academicYearId = event.queryStringParameters?.academicYearId;
      const studentId = event.queryStringParameters?.studentId;
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';
      const results = await feeStructureService.listStudent(ctx.schoolId, academicYearId, studentId, includeDeleted);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public upsertStudent = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<UpsertStudentStructureRequest>(event, callback);
      if (!body) return;
      const result = await feeStructureService.upsertStudent(body, ctx.schoolId, ctx.userId);
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
      const result = await feeStructureService.removeStudent(id, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Student fee override not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Student fee override deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new FeeStructureHandler();
export const create = guard(FEE_ACTIONS['fees-structure-handler.create'], handler.create);
export const update = guard(FEE_ACTIONS['fees-structure-handler.update'], handler.update);
export const remove = guard(FEE_ACTIONS['fees-structure-handler.remove'], handler.remove);
export const list = guard(FEE_ACTIONS['fees-structure-handler.list'], handler.list);
export const bulkApply = guard(FEE_ACTIONS['fees-structure-handler.bulkApply'], handler.bulkApply);
export const copyFromClass = guard(FEE_ACTIONS['fees-structure-handler.copyFromClass'], handler.copyFromClass);
export const listStudent = guard(FEE_ACTIONS['fees-structure-handler.listStudent'], handler.listStudent);
export const upsertStudent = guard(FEE_ACTIONS['fees-structure-handler.upsertStudent'], handler.upsertStudent);
export const removeStudent = guard(FEE_ACTIONS['fees-structure-handler.removeStudent'], handler.removeStudent);
