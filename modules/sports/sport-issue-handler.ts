import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { sportIssueService } from './sport-issue-service';
import { sportItemService } from './sport-item-service';
import { sportService } from './sport-service';
import { CreateIssueLogRequest, UpdateIssueLogRequest, ReturnItemRequest } from './sport-interfaces';
import { SPORT_TYPES, ISSUE_TYPES, ISSUED_TO_TYPES, RETURN_CONDITIONS } from './sport-constants';
import { getDefaultStartDate, getDefaultEndDate, isValidDate } from '../../shared/util/datetime';

class SportIssueHandler {
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

      const body: CreateIssueLogRequest = JSON.parse(event.body);

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

      if (!body.issueDate) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Issue date is required', callback);
        return;
      }

      if (!body.issueType) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Issue type is required', callback);
        return;
      }

      const validIssueTypes = ISSUE_TYPES.map(t => t.value);
      if (!validIssueTypes.includes(body.issueType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid issue type. Must be one of: ${validIssueTypes.join(', ')}`, callback);
        return;
      }

      if (body.quantity !== undefined && body.quantity <= 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback);
        return;
      }

      if (body.issuedToType && !ISSUED_TO_TYPES.includes(body.issuedToType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid issued to type. Must be one of: ${ISSUED_TO_TYPES.join(', ')}`, callback);
        return;
      }

      // Validate item exists
      const item = await sportItemService.getById(body.itemId, schoolId);
      if (!item) {
        ResponseBuilder.badRequest(ErrorCode.InvalidId, 'Item not found', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await sportIssueService.create(body, schoolId, userId);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Issue ID is required', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: UpdateIssueLogRequest = JSON.parse(event.body);

      if (body.issueType) {
        const validIssueTypes = ISSUE_TYPES.map(t => t.value);
        if (!validIssueTypes.includes(body.issueType)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid issue type. Must be one of: ${validIssueTypes.join(', ')}`, callback);
          return;
        }
      }

      if (body.quantity !== undefined && body.quantity <= 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback);
        return;
      }

      if (body.issuedToType && !ISSUED_TO_TYPES.includes(body.issuedToType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid issued to type. Must be one of: ${ISSUED_TO_TYPES.join(', ')}`, callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await sportIssueService.update(id, body, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Issue not found', callback);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Issue ID is required', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const deleted = await sportIssueService.delete(id, schoolId, userId);
      if (!deleted) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Issue not found', callback);
        return;
      }

      ResponseBuilder.ok({ message: 'Issue deleted successfully' }, callback);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Issue ID is required', callback);
        return;
      }

      const result = await sportIssueService.getById(id, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Issue not found', callback);
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
      const issueType = event.queryStringParameters?.issueType;
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

      if (issueType) {
        const validIssueTypes = ISSUE_TYPES.map(t => t.value);
        if (!validIssueTypes.includes(issueType as any)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid issue type. Must be one of: ${validIssueTypes.join(', ')}`, callback);
          return;
        }
      }

      const results = await sportIssueService.search({
        schoolId,
        sportType,
        itemId,
        issueType,
        startDate,
        endDate,
        includeDeleted,
      });

      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public returnItem = async (
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Issue ID is required', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: ReturnItemRequest = JSON.parse(event.body);

      if (!body.returnDate) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Return date is required', callback);
        return;
      }

      if (!body.returnCondition) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Return condition is required', callback);
        return;
      }

      if (!RETURN_CONDITIONS.includes(body.returnCondition as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid return condition. Must be one of: ${RETURN_CONDITIONS.join(', ')}`, callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await sportIssueService.returnItem(id, body, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Issue not found', callback);
        return;
      }

      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SportIssueHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const list = handler.list;
export const returnItem = handler.returnItem;
