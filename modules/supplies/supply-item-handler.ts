import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { supplyService } from './supply-service';
import { supplyItemService } from './supply-item-service';
import { CreateItemRequest, UpdateItemRequest, MergeItemRequest } from './supply-interfaces';
import { SUPPLY_UNITS, ITEM_TYPES, ITEM_CONDITIONS } from './supply-constants';

const VALID_UNITS = SUPPLY_UNITS.map((u) => u.value) as readonly string[];
const VALID_CONDITIONS = ITEM_CONDITIONS.map((c) => c.value) as readonly string[];

class SupplyItemHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: CreateItemRequest = JSON.parse(event.body);

      if (!body.categoryId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'categoryId is required', callback); return; }
      if (!body.name || !body.name.trim()) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Name is required', callback); return; }
      if (!body.unit) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Unit is required', callback); return; }
      if (!VALID_UNITS.includes(body.unit)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid unit. Must be one of: ${VALID_UNITS.join(', ')}`, callback); return; }
      if (body.itemType && !ITEM_TYPES.includes(body.itemType as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid item type. Must be one of: ${ITEM_TYPES.join(', ')}`, callback); return; }
      if (body.itemCondition && !VALID_CONDITIONS.includes(body.itemCondition)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid condition. Must be one of: ${VALID_CONDITIONS.join(', ')}`, callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyItemService.create(body, schoolId, userId);
      // 200 + needsConfirmation flag when the fuzzy guard found near-matches.
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public search = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const results = await supplyItemService.search({
        schoolId,
        userId,
        categoryId: event.queryStringParameters?.categoryId,
        itemType: event.queryStringParameters?.itemType,
        searchTerm: event.queryStringParameters?.search,
        lowStock: event.queryStringParameters?.lowStock === 'true',
        includeDeleted: event.queryStringParameters?.includeDeleted === 'true',
      });
      ResponseBuilder.ok(results, callback);
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }

      const result = await supplyItemService.getById(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Item not found', callback); return; }
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: UpdateItemRequest = JSON.parse(event.body);
      if (body.unit && !VALID_UNITS.includes(body.unit)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid unit. Must be one of: ${VALID_UNITS.join(', ')}`, callback); return; }
      if (body.itemType && !ITEM_TYPES.includes(body.itemType as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid item type. Must be one of: ${ITEM_TYPES.join(', ')}`, callback); return; }
      if (body.itemCondition && !VALID_CONDITIONS.includes(body.itemCondition)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid condition. Must be one of: ${VALID_CONDITIONS.join(', ')}`, callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyItemService.update(id, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Item not found', callback); return; }
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }

      const existing = await supplyItemService.getById(id, schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Item not found', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      await supplyItemService.delete(id, schoolId, userId);
      ResponseBuilder.ok({ message: 'Item deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public merge = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: MergeItemRequest = JSON.parse(event.body);
      if (!body.targetItemId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'targetItemId is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyItemService.merge(id, body.targetItemId, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SupplyItemHandler();
export const create = handler.create;
export const search = handler.search;
export const getById = handler.getById;
export const update = handler.update;
export const remove = handler.remove;
export const merge = handler.merge;
