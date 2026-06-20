import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { sportPurchaseService } from './sport-purchase-service';
import { sportItemService } from './sport-item-service';
import { sportService } from './sport-service';
import { CreatePurchaseLogRequest, UpdatePurchaseLogRequest } from './sport-interfaces';
import { SPORT_TYPES } from './sport-constants';
import { isValidDate } from '../../shared/util/datetime';

class SportPurchaseHandler {
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

      const body: CreatePurchaseLogRequest = JSON.parse(event.body);

      if (!body.itemId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Item ID is required', callback);
        return;
      }

      if (!body.sportType) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Sport type is required', callback);
        return;
      }

      const validSportTypes = SPORT_TYPES.map(t => t.value);
      if (!validSportTypes.includes(body.sportType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid sport type. Must be one of: ${validSportTypes.join(', ')}`, callback);
        return;
      }

      if (!body.purchaseDate) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Purchase date is required', callback);
        return;
      }

      if (!body.quantity || body.quantity <= 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback);
        return;
      }

      // Validate item exists
      const item = await sportItemService.getById(body.itemId, schoolId);
      if (!item) {
        ResponseBuilder.badRequest(ErrorCode.InvalidId, 'Item not found', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await sportPurchaseService.create(body, schoolId, userId);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Purchase ID is required', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: UpdatePurchaseLogRequest = JSON.parse(event.body);

      if (body.quantity !== undefined && body.quantity <= 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await sportPurchaseService.update(id, body, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase not found', callback);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Purchase ID is required', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const deleted = await sportPurchaseService.delete(id, schoolId, userId);
      if (!deleted) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase not found', callback);
        return;
      }

      ResponseBuilder.ok({ message: 'Purchase deleted successfully' }, callback);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Purchase ID is required', callback);
        return;
      }

      const result = await sportPurchaseService.getById(id, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase not found', callback);
        return;
      }

      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (
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
      const itemId = event.queryStringParameters?.itemId;
      const startDate = event.queryStringParameters?.startDate;
      const endDate = event.queryStringParameters?.endDate;
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';

      if (startDate && !isValidDate(startDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid start_date format. Use YYYY-MM-DD', callback);
        return;
      }
      if (endDate && !isValidDate(endDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid end_date format. Use YYYY-MM-DD', callback);
        return;
      }

      const results = await sportPurchaseService.search({
        schoolId,
        sportType,
        itemId,
        startDate,
        endDate,
        includeDeleted,
      });

      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SportPurchaseHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const list = handler.list;
