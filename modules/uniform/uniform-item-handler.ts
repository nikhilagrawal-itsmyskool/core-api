import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { BadRequestResult } from '../../shared/lib/errors';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { uniformItemService } from './uniform-item-service';
import { CATEGORY_VALUES, GENDER_VALUES } from './uniform-constants';

class UniformItemHandler {
  // ── Items ──────────────────────────────────────────────────────────────────

  public createItem = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!body.name) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'name is required', callback); return; }
      if (!body.category || !CATEGORY_VALUES.includes(body.category)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `category must be one of: ${CATEGORY_VALUES.join(', ')}`, callback); return;
      }
      if (!body.gender || !GENDER_VALUES.includes(body.gender)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `gender must be one of: ${GENDER_VALUES.join(', ')}`, callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformItemService.createItem(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      if (err.message?.includes('unique')) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'An item with this name and gender already exists', callback);
      } else {
        ResponseBuilder.handleError(err, callback);
      }
    }
  };

  public listItems = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const q = event.queryStringParameters || {};
      if (q.category && !CATEGORY_VALUES.includes(q.category as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `category must be one of: ${CATEGORY_VALUES.join(', ')}`, callback); return;
      }
      if (q.gender && !GENDER_VALUES.includes(q.gender as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `gender must be one of: ${GENDER_VALUES.join(', ')}`, callback); return;
      }

      const results = await uniformItemService.listItemsWithSizes(schoolId, {
        category: q.category,
        gender: q.gender,
      });
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateItem = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (body.category && !CATEGORY_VALUES.includes(body.category)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `category must be one of: ${CATEGORY_VALUES.join(', ')}`, callback); return;
      }
      if (body.gender && !GENDER_VALUES.includes(body.gender)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `gender must be one of: ${GENDER_VALUES.join(', ')}`, callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformItemService.updateItem(id, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Item not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public deleteItem = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const deleted = await uniformItemService.deleteItem(id, schoolId, userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Item not found', callback); return; }
      ResponseBuilder.ok({ message: 'Item deleted' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ── Sizes ──────────────────────────────────────────────────────────────────

  public createSize = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const itemId = event.pathParameters?.id;
      if (!itemId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }

      const item = await uniformItemService.getItemById(itemId, schoolId);
      if (!item) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Item not found', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!body.sizeLabel) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'sizeLabel is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformItemService.createSize(itemId, body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      if (err.message?.includes('unique')) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'A size with this label already exists for this item', callback);
      } else {
        ResponseBuilder.handleError(err, callback);
      }
    }
  };

  public updateSize = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const sizeId = event.pathParameters?.sizeId;
      if (!sizeId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Size ID is required', callback); return; }

      const body = JSON.parse(event.body || '{}');
      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformItemService.updateSize(sizeId, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Size not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public deleteSize = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const sizeId = event.pathParameters?.sizeId;
      if (!sizeId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Size ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      await uniformItemService.deleteSize(sizeId, schoolId, userId);
      ResponseBuilder.ok({ message: 'Size deleted' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new UniformItemHandler();
export const createItem = handler.createItem;
export const listItems = handler.listItems;
export const updateItem = handler.updateItem;
export const deleteItem = handler.deleteItem;
export const createSize = handler.createSize;
export const updateSize = handler.updateSize;
export const deleteSize = handler.deleteSize;
