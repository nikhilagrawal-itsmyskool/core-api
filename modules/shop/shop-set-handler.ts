import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { shopItemService } from './shop-item-service';
import { shopSetService } from './shop-set-service';
import { SECTION_VALUES } from './shop-constants';

class ShopSetHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!body.name) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'name is required', callback); return; }
      if (!body.classNo || body.classNo < 1 || body.classNo > 12) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'classNo (1-12) is required', callback); return;
      }
      if (!body.academicSession) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicSession is required', callback); return; }

      for (const item of (body.items || [])) {
        if (!item.itemId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Each item requires itemId', callback); return; }
        if (!item.section || !SECTION_VALUES.includes(item.section)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `section must be one of: ${SECTION_VALUES.join(', ')}`, callback); return;
        }
        if (!item.quantity || item.quantity < 1) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Each item requires quantity >= 1', callback); return; }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await shopSetService.createSet(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      if (err.message?.includes('unique')) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'A class set for this class and academic session already exists', callback);
      } else {
        ResponseBuilder.handleError(err, callback);
      }
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const q = event.queryStringParameters || {};
      const results = await shopSetService.listSets(schoolId, {
        classNo: q.classNo ? parseInt(q.classNo, 10) : undefined,
        academicSession: q.academicSession,
      });
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Set ID is required', callback); return; }

      const result = await shopSetService.getSet(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Set not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Set ID is required', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (body.items) {
        for (const item of body.items) {
          if (!item.itemId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Each item requires itemId', callback); return; }
          if (!item.section || !SECTION_VALUES.includes(item.section)) {
            ResponseBuilder.badRequest(ErrorCode.InvalidInput, `section must be one of: ${SECTION_VALUES.join(', ')}`, callback); return;
          }
          if (!item.quantity || item.quantity < 1) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Each item requires quantity >= 1', callback); return; }
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await shopSetService.updateSet(id, body, schoolId, userId);
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
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Set ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const deleted = await shopSetService.deleteSet(id, schoolId, userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Set not found', callback); return; }
      ResponseBuilder.ok({ message: 'Set deleted' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ShopSetHandler();
export const create = handler.create;
export const list = handler.list;
export const getById = handler.getById;
export const update = handler.update;
export const remove = handler.remove;
