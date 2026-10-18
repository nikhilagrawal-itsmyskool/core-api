import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { supplyService } from './supply-service';
import { supplyCategoryService } from './supply-category-service';
import { CreateCategoryRequest, UpdateCategoryRequest } from './supply-interfaces';
import { guard } from '../auth/authz';
import { SUPPLY_ACTIONS } from './supply-actions';

class SupplyCategoryHandler {
  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const results = await supplyCategoryService.list(schoolId, userId);
      ResponseBuilder.ok({ categories: results }, callback);
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Category ID is required', callback); return; }

      const result = await supplyCategoryService.getById(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Category not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: CreateCategoryRequest = JSON.parse(event.body);
      if (!body.name || !body.name.trim()) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Name is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyCategoryService.create(body, schoolId, userId);
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Category ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: UpdateCategoryRequest = JSON.parse(event.body);
      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyCategoryService.update(id, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Category not found', callback); return; }
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Category ID is required', callback); return; }

      const existing = await supplyCategoryService.getById(id, schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Category not found', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      await supplyCategoryService.delete(id, schoolId, userId);
      ResponseBuilder.ok({ message: 'Category deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SupplyCategoryHandler();
const g = (ref: string, fn: any) => guard(SUPPLY_ACTIONS[ref], fn);
export const list = g('supply-category-handler.list', handler.list);
export const getById = g('supply-category-handler.getById', handler.getById);
export const create = g('supply-category-handler.create', handler.create);
export const update = g('supply-category-handler.update', handler.update);
export const remove = g('supply-category-handler.remove', handler.remove);
