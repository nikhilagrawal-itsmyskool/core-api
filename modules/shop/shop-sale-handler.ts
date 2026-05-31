import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { shopItemService } from './shop-item-service';
import { shopSaleService } from './shop-sale-service';

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

class ShopSaleHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!body.studentId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'studentId is required', callback); return; }
      if (!body.saleDate || !isValidDate(body.saleDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'saleDate is required (YYYY-MM-DD)', callback); return;
      }
      if (!Array.isArray(body.items) || body.items.length === 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'At least one item is required', callback); return;
      }
      if (body.amountPaid == null || body.amountPaid < 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'amountPaid is required', callback); return;
      }
      for (const item of body.items) {
        if (!item.itemId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Each item requires itemId', callback); return; }
        if (!item.quantity || item.quantity < 1) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Each item requires quantity >= 1', callback); return; }
      }

      // Validate items exist and have sufficient stock
      for (const item of body.items) {
        const existing = await shopItemService.getItemById(item.itemId, schoolId);
        if (!existing) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Item ${item.itemId} not found`, callback); return;
        }
        if (existing.currentStock < item.quantity) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Insufficient stock for item "${existing.name}": available ${existing.currentStock}, requested ${item.quantity}`, callback); return;
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await shopSaleService.createSale(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const q = event.queryStringParameters || {};
      const results = await shopSaleService.listSales(schoolId, {
        academicSession: q.academicSession,
        studentId: q.studentId,
        startDate: q.startDate,
        endDate: q.endDate,
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Sale ID is required', callback); return; }

      const result = await shopSaleService.getSale(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Sale not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ShopSaleHandler();
export const create = handler.create;
export const list = handler.list;
export const getById = handler.getById;
