import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { transportRouteService } from './transport-route-service';
import {
  AddRouteStopsRequest, CreateRouteRequest, ReorderRouteStopsRequest, UpdateRouteRequest,
} from './transport-interfaces';
import { DIRECTION_VALUES } from './transport-constants';

class TransportRouteHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateRouteRequest>(event, callback);
      if (!body) return;
      if (!body.name || !body.name.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'name is required', callback);
        return;
      }
      if (!DIRECTION_VALUES.includes(body.direction as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `direction must be one of: ${DIRECTION_VALUES.join(', ')}`, callback);
        return;
      }
      const result = await transportRouteService.create(body, ctx.schoolId, ctx.userId);
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
      const body = parseBody<UpdateRouteRequest>(event, callback);
      if (!body) return;
      const result = await transportRouteService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Route not found', callback); return; }
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
      const deleted = await transportRouteService.delete(id, ctx.schoolId, ctx.userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Route not found', callback); return; }
      ResponseBuilder.ok({ message: 'Route deleted successfully' }, callback);
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
      const result = await transportRouteService.getById(id, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Route not found', callback); return; }
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
      if (q.direction && !DIRECTION_VALUES.includes(q.direction as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `direction must be one of: ${DIRECTION_VALUES.join(', ')}`, callback);
        return;
      }
      const results = await transportRouteService.list(ctx.schoolId, q.direction);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /routes/{id}/stops
  public addStops = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<AddRouteStopsRequest>(event, callback);
      if (!body) return;
      const result = await transportRouteService.addStops(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Route not found', callback); return; }
      ResponseBuilder.ok({ stops: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /routes/{id}/stops/{stopId}  (stopId = route_stop uuid)
  public removeStop = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const stopId = requireParam(event, 'stopId', callback);
      if (!stopId) return;
      const result = await transportRouteService.removeStop(id, stopId, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Route not found', callback); return; }
      ResponseBuilder.ok({ stops: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /routes/{id}/stops/order
  public reorderStops = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<ReorderRouteStopsRequest>(event, callback);
      if (!body) return;
      const result = await transportRouteService.reorderStops(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Route not found', callback); return; }
      ResponseBuilder.ok({ stops: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new TransportRouteHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const list = handler.list;
export const addStops = handler.addStops;
export const removeStop = handler.removeStop;
export const reorderStops = handler.reorderStops;
