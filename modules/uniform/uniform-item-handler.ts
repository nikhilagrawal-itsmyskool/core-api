import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { BadRequestResult } from '../../shared/lib/errors';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { uniformItemService } from './uniform-item-service';
import { CATEGORY_VALUES, GENDER_VALUES, SIZING_MODE_VALUES } from './uniform-constants';
import { guard } from '../auth/authz';
import { UNIFORM_ACTIONS } from './uniform-actions';

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
      if (body.sizingMode && !SIZING_MODE_VALUES.includes(body.sizingMode)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `sizingMode must be one of: ${SIZING_MODE_VALUES.join(', ')}`, callback); return;
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

  // ── Price bands (unsized items) ──────────────────────────────────────────────

  public createBand = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
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
      const err = this.validateBand(body);
      if (err) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, err, callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformItemService.createBand(itemId, body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateBand = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const bandId = event.pathParameters?.bandId;
      if (!bandId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Band ID is required', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (body.numberFrom != null && body.numberTo != null && Number(body.numberFrom) > Number(body.numberTo)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'numberFrom must be <= numberTo', callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformItemService.updateBand(bandId, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Band not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public deleteBand = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const bandId = event.pathParameters?.bandId;
      if (!bandId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Band ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      await uniformItemService.deleteBand(bandId, schoolId, userId);
      ResponseBuilder.ok({ message: 'Band deleted' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public suggestPrice = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const itemId = event.pathParameters?.id;
      if (!itemId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }

      const raw = (event.queryStringParameters || {}).number;
      const num = parseInt((raw ?? '').toString(), 10);
      if (isNaN(num)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'number query param is required', callback); return; }

      const result = await uniformItemService.suggestPrice(itemId, num, schoolId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public breakSizes = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const itemId = event.pathParameters?.id;
      if (!itemId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!Array.isArray(body.breakdown) || body.breakdown.length === 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'breakdown (array) is required', callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformItemService.breakIntoSizes(itemId, body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      // breakIntoSizes throws plain Errors for business-rule violations (wrong mode,
      // total mismatch, duplicate numbers) — surface those as 400s.
      if (err instanceof BadRequestResult) { ResponseBuilder.handleError(err, callback); return; }
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, err.message || 'Could not break into numbers', callback);
    }
  };

  public setStock = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const itemId = event.pathParameters?.id;
      if (!itemId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!Array.isArray(body.rows) || body.rows.length === 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'rows (array) is required', callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformItemService.setOpeningStock(itemId, body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      // setOpeningStock throws plain Errors for business-rule violations (unsized item,
      // duplicate/invalid rows) — surface those as 400s.
      if (err instanceof BadRequestResult) { ResponseBuilder.handleError(err, callback); return; }
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, err.message || 'Could not set stock', callback);
    }
  };

  public moveStock = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const itemId = event.pathParameters?.id;
      if (!itemId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Item ID is required', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!body.fromSizeId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'fromSizeId is required', callback); return; }
      if (!body.toSizeId && !(body.toSizeLabel && String(body.toSizeLabel).trim())) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'toSizeId or toSizeLabel is required', callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformItemService.moveStock(itemId, body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      // moveStock throws plain Errors for business-rule violations (insufficient stock,
      // unsized item, same source/target) — surface those as 400s.
      if (err instanceof BadRequestResult) { ResponseBuilder.handleError(err, callback); return; }
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, err.message || 'Could not move stock', callback);
    }
  };

  private validateBand(body: any): string | null {
    if (body.numberFrom == null || body.numberTo == null) return 'numberFrom and numberTo are required';
    if (isNaN(Number(body.numberFrom)) || isNaN(Number(body.numberTo))) return 'numberFrom and numberTo must be numbers';
    if (Number(body.numberFrom) > Number(body.numberTo)) return 'numberFrom must be <= numberTo';
    return null;
  }
}

const handler = new UniformItemHandler();
const g = (ref: string, fn: any) => guard(UNIFORM_ACTIONS[ref], fn);
export const createItem = g('uniform-item-handler.createItem', handler.createItem);
export const listItems = g('uniform-item-handler.listItems', handler.listItems);
export const updateItem = g('uniform-item-handler.updateItem', handler.updateItem);
export const deleteItem = g('uniform-item-handler.deleteItem', handler.deleteItem);
export const createSize = g('uniform-item-handler.createSize', handler.createSize);
export const updateSize = g('uniform-item-handler.updateSize', handler.updateSize);
export const deleteSize = g('uniform-item-handler.deleteSize', handler.deleteSize);
export const createBand = g('uniform-item-handler.createBand', handler.createBand);
export const updateBand = g('uniform-item-handler.updateBand', handler.updateBand);
export const deleteBand = g('uniform-item-handler.deleteBand', handler.deleteBand);
export const suggestPrice = g('uniform-item-handler.suggestPrice', handler.suggestPrice);
export const breakSizes = g('uniform-item-handler.breakSizes', handler.breakSizes);
export const setStock = g('uniform-item-handler.setStock', handler.setStock);
export const moveStock = g('uniform-item-handler.moveStock', handler.moveStock);
