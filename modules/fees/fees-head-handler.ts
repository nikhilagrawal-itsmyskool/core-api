import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './fees-util';
import { feeHeadService, CreateFeeHeadRequest, UpdateFeeHeadRequest } from './fees-head-service';

class FeeHeadHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateFeeHeadRequest>(event, callback);
      if (!body) return;
      const result = await feeHeadService.create(body, ctx.schoolId, ctx.userId);
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
      const body = parseBody<UpdateFeeHeadRequest>(event, callback);
      if (!body) return;
      const result = await feeHeadService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Fee head not found', callback);
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
      const result = await feeHeadService.remove(id, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Fee head not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Fee head deleted successfully' }, callback);
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
      const results = await feeHeadService.list(ctx.schoolId, academicYearId, includeDeleted);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new FeeHeadHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const list = handler.list;
