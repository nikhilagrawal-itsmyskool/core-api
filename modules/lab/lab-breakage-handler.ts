import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { labBreakageService } from './lab-breakage-service';
import { labItemService } from './lab-item-service';
import { labService } from './lab-service';
import { CreateBreakageLogRequest, UpdateBreakageLogRequest } from './lab-interfaces';
import { RESPONSIBLE_TYPES, BREAKAGE_CAUSES, BREAKAGE_ACTIONS, BREAKAGE_STATUSES } from './lab-constants';
import { getDefaultStartDate, getDefaultEndDate, isValidDate } from '../../shared/util/datetime';

class LabBreakageHandler {
  public create = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await labService.getSchoolIdByCode(schoolCode);
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

      if (!body.labId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Lab ID is required', callback);
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
      const item = await labItemService.getById(body.itemId, schoolId);
      if (!item) {
        ResponseBuilder.badRequest(ErrorCode.InvalidId, 'Item not found', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await labBreakageService.create(body, schoolId, userId);
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
      const schoolId = await labService.getSchoolIdByCode(schoolCode);
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

      const result = await labBreakageService.update(id, body, schoolId, userId);
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
      const schoolId = await labService.getSchoolIdByCode(schoolCode);
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

      const deleted = await labBreakageService.delete(id, schoolId, userId);
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
      const schoolId = await labService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Breakage ID is required', callback);
        return;
      }

      const result = await labBreakageService.getById(id, schoolId);
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
      const schoolId = await labService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const labId = event.queryStringParameters?.labId;
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

      const results = await labBreakageService.search({
        schoolId,
        labId,
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

const handler = new LabBreakageHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const list = handler.list;
