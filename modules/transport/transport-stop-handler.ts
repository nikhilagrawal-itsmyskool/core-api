import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { transportStopService } from './transport-stop-service';
import { BulkStopRequest, CreateStopRequest, UpdateStopRequest } from './transport-interfaces';

class TransportStopHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateStopRequest>(event, callback);
      if (!body) return;
      if (!body.name || !body.name.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'name is required', callback);
        return;
      }
      const result = await transportStopService.create(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /stops/bulk — grid upsert (the primary entry path for stops).
  public bulkUpsert = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<BulkStopRequest>(event, callback);
      if (!body) return;
      if (!Array.isArray(body.stops)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'stops array is required', callback);
        return;
      }
      const result = await transportStopService.bulkUpsert(body, ctx.schoolId, ctx.userId);
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
      const body = parseBody<UpdateStopRequest>(event, callback);
      if (!body) return;
      const result = await transportStopService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Stop not found', callback); return; }
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
      const deleted = await transportStopService.delete(id, ctx.schoolId, ctx.userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Stop not found', callback); return; }
      ResponseBuilder.ok({ message: 'Stop deleted successfully' }, callback);
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
      const result = await transportStopService.getById(id, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Stop not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      const results = await transportStopService.list(ctx.schoolId, q.search);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new TransportStopHandler();
export const create = handler.create;
export const bulkUpsert = handler.bulkUpsert;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const list = handler.list;
