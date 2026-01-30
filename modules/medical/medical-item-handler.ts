import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { BadRequestResult, NotFoundResult } from '../../shared/lib/errors';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { medicalItemService } from './medical-item-service';
import { CreateMedicalItemRequest, UpdateMedicalItemRequest } from './medical-interfaces';
import { MEDICAL_UNITS } from './medical-constants';

class MedicalItemHandler {
  public create = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      // Validate school code header
      const schoolCode = validateSchoolCodeHeader(event);

      // Get school ID
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      // Parse body
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: CreateMedicalItemRequest = JSON.parse(event.body);

      // Validate required fields
      if (!body.name || !body.name.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Name is required', callback);
        return;
      }

      if (!body.unit) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Unit is required', callback);
        return;
      }

      // Validate unit value
      const validUnits = MEDICAL_UNITS.map(u => u.value);
      if (!validUnits.includes(body.unit)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid unit. Must be one of: ${validUnits.join(', ')}`, callback);
        return;
      }

      // Get user ID from authorizer context (or use default for local dev)
      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await medicalItemService.create(body, schoolId, userId);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: UpdateMedicalItemRequest = JSON.parse(event.body);

      // Validate unit if provided
      if (body.unit) {
        const validUnits = MEDICAL_UNITS.map(u => u.value);
        if (!validUnits.includes(body.unit)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid unit. Must be one of: ${validUnits.join(', ')}`, callback);
          return;
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await medicalItemService.update(id, body, schoolId, userId);
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback);
        return;
      }

      // Check if item exists
      const existing = await medicalItemService.getById(id, schoolId);
      if (!existing) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Item not found', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      await medicalItemService.delete(id, schoolId, userId);
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback);
        return;
      }

      const result = await medicalItemService.getById(id, schoolId);
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const searchTerm = event.queryStringParameters?.search;
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';

      const results = await medicalItemService.search(schoolId, searchTerm, includeDeleted);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new MedicalItemHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const search = handler.search;
