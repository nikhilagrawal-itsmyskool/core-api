import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { supplyService } from './supply-service';
import { supplyItemService } from './supply-item-service';
import { supplyIssueService } from './supply-issue-service';
import { CreateIssueLogRequest, UpdateIssueLogRequest, ReturnItemRequest } from './supply-interfaces';
import { ISSUE_TYPES, ISSUED_TO_TYPES, RETURN_CONDITIONS } from './supply-constants';
import { getDefaultStartDate, getDefaultEndDate, isValidDate } from '../../shared/util/datetime';

const VALID_ISSUE_TYPES = ISSUE_TYPES.map((t) => t.value) as readonly string[];

class SupplyIssueHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: CreateIssueLogRequest = JSON.parse(event.body);

      if (!body.itemId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Item ID is required', callback); return; }
      if (!body.issueDate) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Issue date is required', callback); return; }
      if (!body.issueType || !VALID_ISSUE_TYPES.includes(body.issueType)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid issue type. Must be one of: ${VALID_ISSUE_TYPES.join(', ')}`, callback); return; }
      if (body.quantity !== undefined && body.quantity <= 0) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback); return; }
      if (body.issuedToType && !ISSUED_TO_TYPES.includes(body.issuedToType as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid issued to type. Must be one of: ${ISSUED_TO_TYPES.join(', ')}`, callback); return; }

      const item = await supplyItemService.getById(body.itemId, schoolId);
      if (!item) { ResponseBuilder.badRequest(ErrorCode.InvalidId, 'Item not found', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyIssueService.create(body, schoolId, userId);
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Issue ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: UpdateIssueLogRequest = JSON.parse(event.body);
      if (body.issueType && !VALID_ISSUE_TYPES.includes(body.issueType)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid issue type. Must be one of: ${VALID_ISSUE_TYPES.join(', ')}`, callback); return; }
      if (body.quantity !== undefined && body.quantity <= 0) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback); return; }
      if (body.issuedToType && !ISSUED_TO_TYPES.includes(body.issuedToType as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid issued to type. Must be one of: ${ISSUED_TO_TYPES.join(', ')}`, callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyIssueService.update(id, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Issue not found', callback); return; }
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Issue ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const deleted = await supplyIssueService.delete(id, schoolId, userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Issue not found', callback); return; }
      ResponseBuilder.ok({ message: 'Issue deleted successfully' }, callback);
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Issue ID is required', callback); return; }

      const result = await supplyIssueService.getById(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Issue not found', callback); return; }
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
      const issueType = event.queryStringParameters?.issueType;
      const startDate = event.queryStringParameters?.startDate || getDefaultStartDate();
      const endDate = event.queryStringParameters?.endDate || getDefaultEndDate();
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';

      if (!isValidDate(startDate)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid startDate. Use YYYY-MM-DD', callback); return; }
      if (!isValidDate(endDate)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid endDate. Use YYYY-MM-DD', callback); return; }
      if (issueType && !VALID_ISSUE_TYPES.includes(issueType as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid issue type. Must be one of: ${VALID_ISSUE_TYPES.join(', ')}`, callback); return; }

      const results = await supplyIssueService.search({ schoolId, itemId, issueType, startDate, endDate, includeDeleted });
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public returnItem = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Issue ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: ReturnItemRequest = JSON.parse(event.body);
      if (!body.returnDate) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Return date is required', callback); return; }
      if (!body.returnCondition || !RETURN_CONDITIONS.includes(body.returnCondition as any)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid return condition. Must be one of: ${RETURN_CONDITIONS.join(', ')}`, callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyIssueService.returnItem(id, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Issue not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SupplyIssueHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const list = handler.list;
export const returnItem = handler.returnItem;
