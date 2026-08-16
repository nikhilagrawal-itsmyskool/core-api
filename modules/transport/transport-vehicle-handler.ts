import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { guard } from '../auth/authz';
import { TRANSPORT_ACTIONS } from './transport-actions';
import { getCallerContext } from '../auth/auth-utils';
import { maskContactFields } from '../../shared/util/mask-phone';
import { transportVehicleService } from './transport-vehicle-service';
import { CreateVehicleRequest, UpdateVehicleRequest } from './transport-interfaces';
import { OWNERSHIP_VALUES, VEHICLE_TYPE_VALUES, TRANSPORT_PHONE_FIELDS } from './transport-constants';

class TransportVehicleHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateVehicleRequest>(event, callback);
      if (!body) return;
      if (!body.registrationNumber || !body.registrationNumber.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'registrationNumber is required', callback);
        return;
      }
      if (!VEHICLE_TYPE_VALUES.includes(body.vehicleType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `vehicleType must be one of: ${VEHICLE_TYPE_VALUES.join(', ')}`, callback);
        return;
      }
      if (!OWNERSHIP_VALUES.includes(body.ownership as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `ownership must be one of: ${OWNERSHIP_VALUES.join(', ')}`, callback);
        return;
      }
      const result = await transportVehicleService.create(body, ctx.schoolId, ctx.userId);
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
      const body = parseBody<UpdateVehicleRequest>(event, callback);
      if (!body) return;
      if (body.vehicleType !== undefined && !VEHICLE_TYPE_VALUES.includes(body.vehicleType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `vehicleType must be one of: ${VEHICLE_TYPE_VALUES.join(', ')}`, callback);
        return;
      }
      if (body.ownership !== undefined && !OWNERSHIP_VALUES.includes(body.ownership as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `ownership must be one of: ${OWNERSHIP_VALUES.join(', ')}`, callback);
        return;
      }
      const result = await transportVehicleService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Vehicle not found', callback); return; }
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
      const deleted = await transportVehicleService.delete(id, ctx.schoolId, ctx.userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Vehicle not found', callback); return; }
      ResponseBuilder.ok({ message: 'Vehicle deleted successfully' }, callback);
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
      const result = await transportVehicleService.getById(id, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Vehicle not found', callback); return; }
      maskContactFields(result, [...TRANSPORT_PHONE_FIELDS], getCallerContext(event).isAdminGod);
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
      const results = await transportVehicleService.list(ctx.schoolId, q.search);
      const reveal = getCallerContext(event).isAdminGod;
      (results as any[]).forEach((r: any) => maskContactFields(r, [...TRANSPORT_PHONE_FIELDS], reveal));
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new TransportVehicleHandler();
export const create = guard(TRANSPORT_ACTIONS['transport-vehicle-handler.create'], handler.create);
export const update = guard(TRANSPORT_ACTIONS['transport-vehicle-handler.update'], handler.update);
export const remove = guard(TRANSPORT_ACTIONS['transport-vehicle-handler.remove'], handler.remove);
export const getById = guard(TRANSPORT_ACTIONS['transport-vehicle-handler.getById'], handler.getById);
export const list = guard(TRANSPORT_ACTIONS['transport-vehicle-handler.list'], handler.list);
