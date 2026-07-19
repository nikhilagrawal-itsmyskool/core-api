import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { assemblyHouseService } from './assembly-house-service';
import { SetConfigRequest, SetHouseMetaRequest, SetWeekHouseRequest } from './assembly-interfaces';

class AssemblyHouseHandler {
  public getConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      ResponseBuilder.ok(await assemblyHouseService.getConfig(ctx.schoolId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public setConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const body = parseBody<SetConfigRequest>(event, callback); if (!body) return;
      ResponseBuilder.ok(await assemblyHouseService.setConfig(body, ctx.schoolId, ctx.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public listHouses = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      ResponseBuilder.ok(await assemblyHouseService.listHouses(ctx.schoolId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public setHouseMeta = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const body = parseBody<SetHouseMetaRequest>(event, callback); if (!body) return;
      const result = await assemblyHouseService.setHouseMeta(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'House not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /plans/{id}/rotation?from=&to=
  public rotation = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const planId = requireParam(event, 'id', callback); if (!planId) return;
      const q = event.queryStringParameters || {};
      const today = new Date().toISOString().slice(0, 10);
      const from = q.from || today;
      const to = q.to || new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
      ResponseBuilder.ok(await assemblyHouseService.weekCalendar(planId, ctx.schoolId, from, to), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // PUT /plans/{id}/rotation  { weekStart, houseId? }
  public setWeekHouse = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const planId = requireParam(event, 'id', callback); if (!planId) return;
      const body = parseBody<SetWeekHouseRequest>(event, callback); if (!body) return;
      ResponseBuilder.ok(await assemblyHouseService.setWeekHouse(planId, body, ctx.schoolId, ctx.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new AssemblyHouseHandler();
export const getConfig = handler.getConfig;
export const setConfig = handler.setConfig;
export const listHouses = handler.listHouses;
export const setHouseMeta = handler.setHouseMeta;
export const rotation = handler.rotation;
export const setWeekHouse = handler.setWeekHouse;
