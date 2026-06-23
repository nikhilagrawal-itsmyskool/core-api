import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { supplyService } from './supply-service';
import { supplyItemService } from './supply-item-service';
import { supplyWastageService } from './supply-wastage-service';
import { CreateWastageLogRequest, UpdateWastageLogRequest } from './supply-interfaces';
import { WASTAGE_REASONS, WASTAGE_ACTIONS, WASTAGE_STATUSES, RESPONSIBLE_TYPES } from './supply-constants';
import { getDefaultStartDate, getDefaultEndDate, isValidDate } from '../../shared/util/datetime';

const VALID_REASONS = WASTAGE_REASONS.map((r) => r.value) as readonly string[];

class SupplyWastageHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: CreateWastageLogRequest = JSON.parse(event.body);

      if (!body.itemId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Item ID is required', callback); return; }
      if (!body.wastageDate) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Wastage date is required', callback); return; }
      if (!body.quantity || body.quantity <= 0) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback); return; }
      if (!body.reason || !VALID_REASONS.includes(body.reason)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`, callback); return; }
      if (body.responsibleType && !RESPONSIBLE_TYPES.includes(body.responsibleType as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid responsible type. Must be one of: ${RESPONSIBLE_TYPES.join(', ')}`, callback); return; }
      if (body.actionTaken && !WASTAGE_ACTIONS.includes(body.actionTaken as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid action. Must be one of: ${WASTAGE_ACTIONS.join(', ')}`, callback); return; }
      if (body.wastageStatus && !WASTAGE_STATUSES.includes(body.wastageStatus as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid wastage status. Must be one of: ${WASTAGE_STATUSES.join(', ')}`, callback); return; }

      const item = await supplyItemService.getById(body.itemId, schoolId);
      if (!item) { ResponseBuilder.badRequest(ErrorCode.InvalidId, 'Item not found', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyWastageService.create(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Wastage ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: UpdateWastageLogRequest = JSON.parse(event.body);
      if (body.quantity !== undefined && body.quantity <= 0) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback); return; }
      if (body.reason && !VALID_REASONS.includes(body.reason)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`, callback); return; }
      if (body.responsibleType && !RESPONSIBLE_TYPES.includes(body.responsibleType as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid responsible type. Must be one of: ${RESPONSIBLE_TYPES.join(', ')}`, callback); return; }
      if (body.actionTaken && !WASTAGE_ACTIONS.includes(body.actionTaken as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid action. Must be one of: ${WASTAGE_ACTIONS.join(', ')}`, callback); return; }
      if (body.wastageStatus && !WASTAGE_STATUSES.includes(body.wastageStatus as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid wastage status. Must be one of: ${WASTAGE_STATUSES.join(', ')}`, callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyWastageService.update(id, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Wastage not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Wastage ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const deleted = await supplyWastageService.delete(id, schoolId, userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Wastage not found', callback); return; }
      ResponseBuilder.ok({ message: 'Wastage deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Wastage ID is required', callback); return; }

      const result = await supplyWastageService.getById(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Wastage not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const itemId = event.queryStringParameters?.itemId;
      const reason = event.queryStringParameters?.reason;
      const startDate = event.queryStringParameters?.startDate || getDefaultStartDate();
      const endDate = event.queryStringParameters?.endDate || getDefaultEndDate();
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';

      if (!isValidDate(startDate)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid startDate. Use YYYY-MM-DD', callback); return; }
      if (!isValidDate(endDate)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid endDate. Use YYYY-MM-DD', callback); return; }
      if (reason && !VALID_REASONS.includes(reason as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`, callback); return; }

      const results = await supplyWastageService.search({ schoolId, itemId, reason, startDate, endDate, includeDeleted });
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getImage = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Wastage ID is required', callback); return; }

      const result = await supplyWastageService.getImage(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Image not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public deleteImage = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Wastage ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      await supplyWastageService.deleteImage(id, schoolId, userId);
      ResponseBuilder.ok({ message: 'Image deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SupplyWastageHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const list = handler.list;
export const getImage = handler.getImage;
export const deleteImage = handler.deleteImage;
