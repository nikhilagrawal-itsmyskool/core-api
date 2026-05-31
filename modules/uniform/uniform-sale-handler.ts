import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { uniformItemService } from './uniform-item-service';
import { uniformSaleService } from './uniform-sale-service';
import { SALE_TYPE_VALUES, PAYMENT_STATUS_VALUES } from './uniform-constants';

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

class UniformSaleHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!body.studentId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'studentId is required', callback); return; }
      if (!body.saleDate || !isValidDate(body.saleDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'saleDate is required (YYYY-MM-DD)', callback); return;
      }
      if (!body.saleType || !SALE_TYPE_VALUES.includes(body.saleType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `saleType must be one of: ${SALE_TYPE_VALUES.join(', ')}`, callback); return;
      }
      if (!Array.isArray(body.items) || body.items.length === 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'At least one item is required', callback); return;
      }
      if (body.amountPaid == null || body.amountPaid < 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'amountPaid is required and must be >= 0', callback); return;
      }
      for (const item of body.items) {
        if (!item.itemId || !item.sizeId) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Each item requires itemId and sizeId', callback); return;
        }
        if (!item.quantity || item.quantity < 1) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Each item requires quantity >= 1', callback); return;
        }
      }

      // Validate sizes belong to items and check stock
      for (const item of body.items) {
        const size = await uniformItemService.getSizeById(item.sizeId, schoolId);
        if (!size || size.itemId !== item.itemId) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Size ${item.sizeId} not found for item ${item.itemId}`, callback); return;
        }
        if (size.currentStock < item.quantity) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Insufficient stock for size ${size.sizeLabel} (available: ${size.currentStock})`, callback); return;
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformSaleService.create(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const q = event.queryStringParameters || {};
      if (q.paymentStatus) {
        const statuses = q.paymentStatus.split(',');
        for (const s of statuses) {
          if (!PAYMENT_STATUS_VALUES.includes(s as any)) {
            ResponseBuilder.badRequest(ErrorCode.InvalidInput, `paymentStatus values must be one of: ${PAYMENT_STATUS_VALUES.join(', ')}`, callback); return;
          }
        }
      }
      if (q.saleType && !SALE_TYPE_VALUES.includes(q.saleType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `saleType must be one of: ${SALE_TYPE_VALUES.join(', ')}`, callback); return;
      }

      const results = await uniformSaleService.listSales(schoolId, {
        studentId: q.studentId,
        paymentStatus: q.paymentStatus,
        saleType: q.saleType,
        startDate: q.startDate,
        endDate: q.endDate,
        search: q.search,
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
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Sale ID is required', callback); return; }

      const result = await uniformSaleService.getSale(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Sale not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public addPayment = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const saleId = event.pathParameters?.id;
      if (!saleId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Sale ID is required', callback); return; }

      const sale = await uniformSaleService.getSale(saleId, schoolId);
      if (!sale) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Sale not found', callback); return; }
      if (sale.paymentStatus === 'paid') {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Sale is already fully paid', callback); return;
      }

      const body = JSON.parse(event.body || '{}');
      if (!body.amount || body.amount <= 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'amount must be greater than 0', callback); return;
      }
      const balance = (sale.totalAmount || 0) - (sale.amountPaid || 0);
      if (body.amount > balance) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `amount cannot exceed balance due (₹${balance.toFixed(2)})`, callback); return;
      }
      if (!body.paymentDate || !isValidDate(body.paymentDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'paymentDate is required (YYYY-MM-DD)', callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformSaleService.addPayment(saleId, body.amount, body.paymentDate, body.notes, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public createReturn = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const saleId = event.pathParameters?.id;
      if (!saleId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Sale ID is required', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!body.saleItemId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'saleItemId is required', callback); return; }
      if (!body.returnDate || !isValidDate(body.returnDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'returnDate is required (YYYY-MM-DD)', callback); return;
      }
      if (!body.quantity || body.quantity < 1) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'quantity must be >= 1', callback); return;
      }
      if (!body.reason || !body.reason.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'reason is required', callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await uniformSaleService.createReturn(saleId, body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      if (err.message?.startsWith('Cannot return') || err.message === 'Sale item not found') {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, err.message, callback);
      } else {
        ResponseBuilder.handleError(err, callback);
      }
    }
  };

  public getReturnEvidence = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const returnId = event.pathParameters?.returnId;
      if (!returnId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Return ID is required', callback); return; }

      const result = await uniformSaleService.getReturnEvidence(returnId, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Evidence not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new UniformSaleHandler();
export const create = handler.create;
export const list = handler.list;
export const getById = handler.getById;
export const addPayment = handler.addPayment;
export const createReturn = handler.createReturn;
export const getReturnEvidence = handler.getReturnEvidence;
