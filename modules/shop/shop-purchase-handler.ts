import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { shopItemService } from './shop-item-service';
import { shopPurchaseService } from './shop-purchase-service';
import { UploadBillRequest } from './shop-interfaces';

const ALLOWED_BILL_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

class ShopPurchaseHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!body.purchaseDate || !isValidDate(body.purchaseDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'purchaseDate is required (YYYY-MM-DD)', callback); return;
      }
      if (!Array.isArray(body.items) || body.items.length === 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'At least one item is required', callback); return;
      }
      for (const item of body.items) {
        if (!item.itemId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Each item requires itemId', callback); return; }
        if (!item.quantity || item.quantity < 1) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Each item requires quantity >= 1', callback); return; }
        if (item.mrp == null || item.mrp <= 0) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Each item requires mrp > 0', callback); return; }
      }

      if (body.bill) {
        if (!body.bill.fileName || !body.bill.mimeType || !body.bill.base64Data) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'bill must include fileName, mimeType, and base64Data', callback); return;
        }
        if (!ALLOWED_BILL_MIME_TYPES.includes(body.bill.mimeType)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `bill mimeType must be one of: ${ALLOWED_BILL_MIME_TYPES.join(', ')}`, callback); return;
        }
      }

      // Validate all itemIds exist
      for (const item of body.items) {
        const existing = await shopItemService.getItemById(item.itemId, schoolId);
        if (!existing) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Item ${item.itemId} not found`, callback); return;
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await shopPurchaseService.createBatch(body, schoolId, userId);
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
      const results = await shopPurchaseService.listBatches(schoolId, {
        startDate: q.startDate,
        endDate: q.endDate,
        academicSession: q.academicSession,
        supplier: q.supplier,
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Purchase ID is required', callback); return; }

      const result = await shopPurchaseService.getBatch(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase not found', callback); return; }
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Purchase ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const deleted = await shopPurchaseService.deleteBatch(id, schoolId, userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase not found', callback); return; }
      ResponseBuilder.ok({ message: 'Purchase deleted and stock reversed' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public uploadBill = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Purchase ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: UploadBillRequest = JSON.parse(event.body);
      if (!body.fileName || !body.mimeType || !body.base64Data) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'fileName, mimeType, and base64Data are required', callback); return;
      }
      if (!ALLOWED_BILL_MIME_TYPES.includes(body.mimeType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `mimeType must be one of: ${ALLOWED_BILL_MIME_TYPES.join(', ')}`, callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await shopPurchaseService.uploadBill(id, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getBill = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Purchase ID is required', callback); return; }

      const result = await shopPurchaseService.getBill(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Bill not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public deleteBill = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Purchase ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const deleted = await shopPurchaseService.deleteBill(id, schoolId, userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase not found', callback); return; }
      ResponseBuilder.ok({ message: 'Bill deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ShopPurchaseHandler();
export const create = handler.create;
export const list = handler.list;
export const getById = handler.getById;
export const remove = handler.remove;
export const uploadBill = handler.uploadBill;
export const getBill = handler.getBill;
export const deleteBill = handler.deleteBill;
