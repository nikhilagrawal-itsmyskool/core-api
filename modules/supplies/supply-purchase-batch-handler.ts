import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { supplyService } from './supply-service';
import { supplyPurchaseBatchService } from './supply-purchase-batch-service';
import { CreateBulkPurchaseRequest, UpdatePurchaseBatchRequest } from './supply-interfaces';
import { SUPPLY_UNITS } from './supply-constants';
import { isValidDate } from '../../shared/util/datetime';

const VALID_UNITS = SUPPLY_UNITS.map((u) => u.value) as readonly string[];
const ALLOWED_BILL_MIME = ['application/pdf', 'image/jpeg', 'image/png'];

class SupplyPurchaseBatchHandler {
  public createBulk = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: CreateBulkPurchaseRequest = JSON.parse(event.body);

      if (!body.purchaseDate || !isValidDate(body.purchaseDate)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Valid purchaseDate (YYYY-MM-DD) is required', callback); return; }
      if (!Array.isArray(body.items) || body.items.length === 0) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'items must be a non-empty array', callback); return; }

      for (let i = 0; i < body.items.length; i++) {
        const line = body.items[i];
        const hasItemId = !!line.itemId;
        const hasNewItem = !!line.newItem;
        if (hasItemId === hasNewItem) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}] must have exactly one of itemId or newItem`, callback); return; }
        if (hasNewItem) {
          const ni = line.newItem!;
          if (!ni.name || !ni.name.trim()) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].newItem.name is required`, callback); return; }
          if (!ni.categoryId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].newItem.categoryId is required`, callback); return; }
          if (!ni.unit || !VALID_UNITS.includes(ni.unit)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].newItem.unit must be one of: ${VALID_UNITS.join(', ')}`, callback); return; }
        }
        if (!line.quantity || line.quantity <= 0) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].quantity must be greater than 0`, callback); return; }
      }

      if (body.bill) {
        if (!body.bill.fileName || !body.bill.mimeType || !body.bill.base64Data) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'bill must have fileName, mimeType, and base64Data', callback); return; }
        if (!ALLOWED_BILL_MIME.includes(body.bill.mimeType)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `bill mimeType must be one of: ${ALLOWED_BILL_MIME.join(', ')}`, callback); return; }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyPurchaseBatchService.createBulk(body, schoolId, userId);
      // result may be { needsConfirmation, conflicts } (200) or the created batch.
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const startDate = event.queryStringParameters?.startDate;
      const endDate = event.queryStringParameters?.endDate;
      if (startDate && !isValidDate(startDate)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid startDate. Use YYYY-MM-DD', callback); return; }
      if (endDate && !isValidDate(endDate)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid endDate. Use YYYY-MM-DD', callback); return; }

      const results = await supplyPurchaseBatchService.listBatches({
        schoolId, startDate, endDate,
        includeDeleted: event.queryStringParameters?.includeDeleted === 'true',
        itemId: event.queryStringParameters?.itemId,
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
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback); return; }

      const result = await supplyPurchaseBatchService.getBatchById(batchId, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase batch not found', callback); return; }
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

      const batchId = event.pathParameters?.batchId;
      if (!batchId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: UpdatePurchaseBatchRequest = JSON.parse(event.body);
      if (body.items !== undefined) {
        if (!Array.isArray(body.items)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'items must be an array', callback); return; }
        for (let i = 0; i < body.items.length; i++) {
          const line = body.items[i];
          if (!line.itemId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].itemId is required`, callback); return; }
          if (!line.quantity || line.quantity <= 0) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].quantity must be greater than 0`, callback); return; }
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyPurchaseBatchService.update(batchId, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase batch not found', callback); return; }
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

      const batchId = event.pathParameters?.batchId;
      if (!batchId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const deleted = await supplyPurchaseBatchService.deleteBatch(batchId, schoolId, userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase batch not found', callback); return; }
      ResponseBuilder.ok({ message: 'Purchase batch deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public restore = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyPurchaseBatchService.restoreBatch(batchId, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Deleted purchase batch not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public uploadBill = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body = JSON.parse(event.body);
      if (!body.fileName || !body.mimeType || !body.base64Data) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'fileName, mimeType, and base64Data are required', callback); return; }
      if (!ALLOWED_BILL_MIME.includes(body.mimeType)) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, `mimeType must be one of: ${ALLOWED_BILL_MIME.join(', ')}`, callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyPurchaseBatchService.uploadBill(batchId, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase batch not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getBill = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback); return; }

      const result = await supplyPurchaseBatchService.getBill(batchId, schoolId);
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
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      await supplyPurchaseBatchService.deleteBill(batchId, schoolId, userId);
      ResponseBuilder.ok({ message: 'Bill deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SupplyPurchaseBatchHandler();
export const createBulk = handler.createBulk;
export const list = handler.list;
export const getById = handler.getById;
export const update = handler.update;
export const remove = handler.remove;
export const restore = handler.restore;
export const uploadBill = handler.uploadBill;
export const getBill = handler.getBill;
export const deleteBill = handler.deleteBill;
