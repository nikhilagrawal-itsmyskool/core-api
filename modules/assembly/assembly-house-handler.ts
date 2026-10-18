import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { guard } from "../auth/authz";
import { ASSEMBLY_ACTIONS } from "./assembly-actions";
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { assemblyHouseService } from './assembly-house-service';
import { SetConfigRequest, SetHouseRotationRequest, SetWeekHouseRequest } from './assembly-interfaces';
import { istToday } from '../../shared/util/datetime';

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

  // PUT /houses/{id}/rotation — set/clear this house's assembly rotation order.
  public setRotation = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const body = parseBody<SetHouseRotationRequest>(event, callback); if (!body) return;
      const result = await assemblyHouseService.setHouseRotation(id, body, ctx.schoolId, ctx.userId);
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
      const today = istToday();
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
const g = (ref: string, fn: any) => guard(ASSEMBLY_ACTIONS[ref], fn);
export const getConfig = g("assembly-house-handler.getConfig", handler.getConfig);
export const setConfig = g("assembly-house-handler.setConfig", handler.setConfig);
export const listHouses = g("assembly-house-handler.listHouses", handler.listHouses);
export const setRotation = g("assembly-house-handler.setRotation", handler.setRotation);
export const rotation = g("assembly-house-handler.rotation", handler.rotation);
export const setWeekHouse = g("assembly-house-handler.setWeekHouse", handler.setWeekHouse);
