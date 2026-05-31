import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { uniformItemService } from './uniform-item-service';
import { uniformSetService } from './uniform-set-service';
import { GENDER_VALUES } from './uniform-constants';

class UniformSetHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!body.name) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'name is required', callback); return; }
      if (body.gender && !GENDER_VALUES.includes(body.gender)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `gender must be one of: ${GENDER_VALUES.join(', ')}`, callback); return;
      }
      if (!Array.isArray(body.items) || body.items.length === 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'At least one item is required', callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformSetService.create(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      if (err.message?.includes('unique')) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'A set with this name already exists', callback);
      } else {
        ResponseBuilder.handleError(err, callback);
      }
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const q = event.queryStringParameters || {};
      const results = await uniformSetService.list(schoolId, q.gender);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Set ID is required', callback); return; }

      const result = await uniformSetService.getById(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Set not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public expandSet = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Set ID is required', callback); return; }

      const result = await uniformSetService.expandSet(id, schoolId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Set ID is required', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (body.gender && !GENDER_VALUES.includes(body.gender)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `gender must be one of: ${GENDER_VALUES.join(', ')}`, callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformSetService.update(id, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Set not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Set ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      await uniformSetService.delete(id, schoolId, userId);
      ResponseBuilder.ok({ message: 'Set deleted' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new UniformSetHandler();
export const create = handler.create;
export const list = handler.list;
export const getById = handler.getById;
export const expandSet = handler.expandSet;
export const update = handler.update;
export const remove = handler.remove;
