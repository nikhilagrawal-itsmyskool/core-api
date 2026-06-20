import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { sportItemService } from './sport-item-service';
import { sportService } from './sport-service';
import { CreateSportItemRequest, UpdateSportItemRequest } from './sport-interfaces';
import { SPORT_UNITS, SPORT_TYPES, ITEM_TYPES, ITEM_CONDITIONS } from './sport-constants';

class SportItemHandler {
  public create = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: CreateSportItemRequest = JSON.parse(event.body);

      if (!body.sportType) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Sport type is required', callback);
        return;
      }

      const validSportTypes = SPORT_TYPES.map(t => t.value);
      if (!validSportTypes.includes(body.sportType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid sport type. Must be one of: ${validSportTypes.join(', ')}`, callback);
        return;
      }

      if (!body.name || !body.name.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Name is required', callback);
        return;
      }

      if (!body.itemType) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Item type is required', callback);
        return;
      }

      if (!ITEM_TYPES.includes(body.itemType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid item type. Must be one of: ${ITEM_TYPES.join(', ')}`, callback);
        return;
      }

      if (!body.unit) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Unit is required', callback);
        return;
      }

      const validUnits = SPORT_UNITS.map(u => u.value);
      if (!validUnits.includes(body.unit)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid unit. Must be one of: ${validUnits.join(', ')}`, callback);
        return;
      }

      if (body.itemCondition) {
        const validConditions = ITEM_CONDITIONS.map(c => c.value);
        if (!validConditions.includes(body.itemCondition)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid condition. Must be one of: ${validConditions.join(', ')}`, callback);
          return;
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await sportItemService.create(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: UpdateSportItemRequest = JSON.parse(event.body);

      if (body.unit) {
        const validUnits = SPORT_UNITS.map(u => u.value);
        if (!validUnits.includes(body.unit)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid unit. Must be one of: ${validUnits.join(', ')}`, callback);
          return;
        }
      }

      if (body.itemType) {
        if (!ITEM_TYPES.includes(body.itemType as any)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid item type. Must be one of: ${ITEM_TYPES.join(', ')}`, callback);
          return;
        }
      }

      if (body.itemCondition) {
        const validConditions = ITEM_CONDITIONS.map(c => c.value);
        if (!validConditions.includes(body.itemCondition)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid condition. Must be one of: ${validConditions.join(', ')}`, callback);
          return;
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await sportItemService.update(id, body, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Item not found', callback);
        return;
      }

      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback);
        return;
      }

      const existing = await sportItemService.getById(id, schoolId);
      if (!existing) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Item not found', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      await sportItemService.delete(id, schoolId, userId);
      ResponseBuilder.ok({ message: 'Item deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback);
        return;
      }

      const result = await sportItemService.getById(id, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Item not found', callback);
        return;
      }

      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public search = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const sportType = event.queryStringParameters?.sportType;
      const category = event.queryStringParameters?.category;
      const itemType = event.queryStringParameters?.itemType;
      const searchTerm = event.queryStringParameters?.search;
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';

      const results = await sportItemService.search(schoolId, sportType, category, itemType, searchTerm, includeDeleted);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SportItemHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const search = handler.search;
