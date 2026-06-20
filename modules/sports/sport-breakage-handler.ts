import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { sportBreakageService } from './sport-breakage-service';
import { sportItemService } from './sport-item-service';
import { sportService } from './sport-service';
import { CreateBreakageLogRequest, UpdateBreakageLogRequest } from './sport-interfaces';
import { SPORT_TYPES, RESPONSIBLE_TYPES, BREAKAGE_CAUSES, BREAKAGE_ACTIONS, BREAKAGE_STATUSES } from './sport-constants';
import { getDefaultStartDate, getDefaultEndDate, isValidDate } from '../../shared/util/datetime';

class SportBreakageHandler {
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

      const body: CreateBreakageLogRequest = JSON.parse(event.body);

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

      if (!body.breakageDate) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Breakage date is required', callback);
        return;
      }

      if (!body.quantity || body.quantity <= 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback);
        return;
      }

      if (body.responsibleType && !RESPONSIBLE_TYPES.includes(body.responsibleType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid responsible type. Must be one of: ${RESPONSIBLE_TYPES.join(', ')}`, callback);
        return;
      }

      if (body.cause && !BREAKAGE_CAUSES.includes(body.cause as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid cause. Must be one of: ${BREAKAGE_CAUSES.join(', ')}`, callback);
        return;
      }

      if (body.actionTaken && !BREAKAGE_ACTIONS.includes(body.actionTaken as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid action. Must be one of: ${BREAKAGE_ACTIONS.join(', ')}`, callback);
        return;
      }

      if (body.breakageStatus && !BREAKAGE_STATUSES.includes(body.breakageStatus as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid breakage status. Must be one of: ${BREAKAGE_STATUSES.join(', ')}`, callback);
        return;
      }

      // Validate item exists
      const item = await sportItemService.getById(body.itemId, schoolId);
      if (!item) {
        ResponseBuilder.badRequest(ErrorCode.InvalidId, 'Item not found', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await sportBreakageService.create(body, schoolId, userId);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Breakage ID is required', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: UpdateBreakageLogRequest = JSON.parse(event.body);

      if (body.quantity !== undefined && body.quantity <= 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback);
        return;
      }

      if (body.responsibleType && !RESPONSIBLE_TYPES.includes(body.responsibleType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid responsible type. Must be one of: ${RESPONSIBLE_TYPES.join(', ')}`, callback);
        return;
      }

      if (body.cause && !BREAKAGE_CAUSES.includes(body.cause as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid cause. Must be one of: ${BREAKAGE_CAUSES.join(', ')}`, callback);
        return;
      }

      if (body.actionTaken && !BREAKAGE_ACTIONS.includes(body.actionTaken as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid action. Must be one of: ${BREAKAGE_ACTIONS.join(', ')}`, callback);
        return;
      }

      if (body.breakageStatus && !BREAKAGE_STATUSES.includes(body.breakageStatus as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid breakage status. Must be one of: ${BREAKAGE_STATUSES.join(', ')}`, callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await sportBreakageService.update(id, body, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Breakage not found', callback);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Breakage ID is required', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const deleted = await sportBreakageService.delete(id, schoolId, userId);
      if (!deleted) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Breakage not found', callback);
        return;
      }

      ResponseBuilder.ok({ message: 'Breakage deleted successfully' }, callback);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Breakage ID is required', callback);
        return;
      }

      const result = await sportBreakageService.getById(id, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Breakage not found', callback);
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
      const startDate = event.queryStringParameters?.startDate || getDefaultStartDate();
      const endDate = event.queryStringParameters?.endDate || getDefaultEndDate();
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';

      if (!isValidDate(startDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid start_date format. Use YYYY-MM-DD', callback);
        return;
      }
      if (!isValidDate(endDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid end_date format. Use YYYY-MM-DD', callback);
        return;
      }

      const results = await sportBreakageService.search({
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

  public getImage = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Breakage ID is required', callback); return; }

      const result = await sportBreakageService.getImage(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Image not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public deleteImage = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Breakage ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      await sportBreakageService.deleteImage(id, schoolId, userId);
      ResponseBuilder.ok({ message: 'Image deleted successfully' }, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new SportBreakageHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const list = handler.list;
export const getImage = handler.getImage;
export const deleteImage = handler.deleteImage;
