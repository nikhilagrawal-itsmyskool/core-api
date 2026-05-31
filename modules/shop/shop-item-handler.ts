import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { shopItemService } from './shop-item-service';
import { ITEM_TYPE_VALUES } from './shop-constants';

class ShopItemHandler {
  public createItem = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!body.name) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'name is required', callback); return; }
      if (!body.type || !ITEM_TYPE_VALUES.includes(body.type)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `type must be one of: ${ITEM_TYPE_VALUES.join(', ')}`, callback); return;
      }
      if (body.type === 'book') {
        if (!body.subject) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'subject is required for books', callback); return; }
        if (!body.publisher) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'publisher is required for books', callback); return; }
        if (!body.classNo || body.classNo < 1 || body.classNo > 12) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'classNo (1-12) is required for books', callback); return;
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await shopItemService.createItem(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      if (err.message?.includes('unique')) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'An item with this name already exists', callback);
      } else {
        ResponseBuilder.handleError(err, callback);
      }
    }
  };

  public listItems = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const q = event.queryStringParameters || {};
      if (q.type && !ITEM_TYPE_VALUES.includes(q.type as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `type must be one of: ${ITEM_TYPE_VALUES.join(', ')}`, callback); return;
      }

      const results = await shopItemService.listItemsWithPricing(schoolId, {
        type: q.type,
        classNo: q.classNo ? parseInt(q.classNo, 10) : undefined,
        academicSession: q.academicSession,
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
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }

      const body = JSON.parse(event.body || '{}');
      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await shopItemService.updateItem(id, body, schoolId, userId);
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
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const deleted = await shopItemService.deleteItem(id, schoolId, userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Item not found', callback); return; }
      ResponseBuilder.ok({ message: 'Item deleted' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ShopItemHandler();
export const createItem = handler.createItem;
export const listItems = handler.listItems;
export const updateItem = handler.updateItem;
export const deleteItem = handler.deleteItem;
