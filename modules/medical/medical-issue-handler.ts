import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { medicalIssueService } from './medical-issue-service';
import { medicalItemService } from './medical-item-service';
import { CreateIssueLogRequest, UpdateIssueLogRequest } from './medical-interfaces';
import { ENTITY_TYPES } from './medical-constants';
import { getDefaultStartDate, getDefaultEndDate, isValidDate } from '../../shared/util/datetime';

class MedicalIssueHandler {
  public create = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: CreateIssueLogRequest = JSON.parse(event.body);

      // Validate required fields
      if (!body.itemId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Item ID is required', callback);
        return;
      }

      if (!body.issueDate) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Issue date is required', callback);
        return;
      }

      if (!body.entityType) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Entity type is required', callback);
        return;
      }

      if (!ENTITY_TYPES.includes(body.entityType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Entity type must be one of: ${ENTITY_TYPES.join(', ')}`, callback);
        return;
      }

      if (!body.entityId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Entity ID is required', callback);
        return;
      }

      if (body.quantity !== undefined && body.quantity <= 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback);
        return;
      }

      // Validate item exists
      const item = await medicalItemService.getById(body.itemId, schoolId);
      if (!item) {
        ResponseBuilder.badRequest(ErrorCode.InvalidId, 'Item not found', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await medicalIssueService.create(body, schoolId, userId);
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
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

      // Validate entityType if provided
      if (body.entityType && !ENTITY_TYPES.includes(body.entityType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Entity type must be one of: ${ENTITY_TYPES.join(', ')}`, callback);
        return;
      }

      // Validate quantity if provided
      if (body.quantity !== undefined && body.quantity <= 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Quantity must be greater than 0', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await medicalIssueService.update(id, body, schoolId, userId);
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
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

      const deleted = await medicalIssueService.delete(id, schoolId, userId);
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Issue ID is required', callback);
        return;
      }

      const result = await medicalIssueService.getById(id, schoolId);
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const itemId = event.queryStringParameters?.itemId;
      const entityType = event.queryStringParameters?.entityType;
      const entityId = event.queryStringParameters?.entityId;
      const startDate = event.queryStringParameters?.startDate || getDefaultStartDate();
      const endDate = event.queryStringParameters?.endDate || getDefaultEndDate();
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';

      // Validate dates
      if (!isValidDate(startDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid start_date format. Use YYYY-MM-DD', callback);
        return;
      }
      if (!isValidDate(endDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid end_date format. Use YYYY-MM-DD', callback);
        return;
      }

      // Validate entity_type if provided
      if (entityType && !ENTITY_TYPES.includes(entityType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Entity type must be one of: ${ENTITY_TYPES.join(', ')}`, callback);
        return;
      }

      const results = await medicalIssueService.search({
        schoolId,
        itemId,
        entityType,
        entityId,
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

const handler = new MedicalIssueHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const list = handler.list;
