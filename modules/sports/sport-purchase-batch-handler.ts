import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { sportService } from './sport-service';
import { sportPurchaseBatchService } from './sport-purchase-batch-service';
import {
  CreateBulkSportPurchaseRequest,
  UpdateSportPurchaseBatchRequest,
} from './sport-interfaces';
import { SPORT_TYPES } from './sport-constants';
import { isValidDate } from '../../shared/util/datetime';

const VALID_SPORT_TYPES = SPORT_TYPES.map((t) => t.value) as readonly string[];

class SportPurchaseBatchHandler {
  public createBulk = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: CreateBulkSportPurchaseRequest = JSON.parse(event.body);

      if (!body.purchaseDate) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'purchaseDate is required', callback);
        return;
      }

      if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'items must be a non-empty array', callback);
        return;
      }

      for (let i = 0; i < body.items.length; i++) {
        const item = body.items[i];
        if (!item.itemId) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].itemId is required`, callback);
          return;
        }
        if (!item.sportType || !VALID_SPORT_TYPES.includes(item.sportType)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].sportType must be one of: ${VALID_SPORT_TYPES.join(', ')}`, callback);
          return;
        }
        if (!item.quantity || item.quantity <= 0) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].quantity must be greater than 0`, callback);
          return;
        }
      }

      if (body.bill) {
        if (!body.bill.fileName || !body.bill.mimeType || !body.bill.base64Data) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'bill must have fileName, mimeType, and base64Data', callback);
          return;
        }
        const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
        if (!allowed.includes(body.bill.mimeType)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, `bill mimeType must be one of: ${allowed.join(', ')}`, callback);
          return;
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await sportPurchaseBatchService.createBulk(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const startDate = event.queryStringParameters?.startDate;
      const endDate = event.queryStringParameters?.endDate;
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';
      const sportType = event.queryStringParameters?.sportType;
      const itemId = event.queryStringParameters?.itemId;

      if (startDate && !isValidDate(startDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid startDate format. Use YYYY-MM-DD', callback);
        return;
      }
      if (endDate && !isValidDate(endDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid endDate format. Use YYYY-MM-DD', callback);
        return;
      }

      const results = await sportPurchaseBatchService.listBatches({
        schoolId,
        startDate,
        endDate,
        includeDeleted,
        sportType,
        itemId,
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
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback);
        return;
      }

      const result = await sportPurchaseBatchService.getBatchById(batchId, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase batch not found', callback);
        return;
      }

      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: UpdateSportPurchaseBatchRequest = JSON.parse(event.body);

      if (body.items !== undefined) {
        if (!Array.isArray(body.items)) {
          ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'items must be an array', callback);
          return;
        }
        for (let i = 0; i < body.items.length; i++) {
          const item = body.items[i];
          if (!item.itemId) {
            ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].itemId is required`, callback);
            return;
          }
          if (!item.sportType || !VALID_SPORT_TYPES.includes(item.sportType)) {
            ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].sportType must be one of: ${VALID_SPORT_TYPES.join(', ')}`, callback);
            return;
          }
          if (!item.quantity || item.quantity <= 0) {
            ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].quantity must be greater than 0`, callback);
            return;
          }
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await sportPurchaseBatchService.update(batchId, body, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase batch not found', callback);
        return;
      }

      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const deleted = await sportPurchaseBatchService.deleteBatch(batchId, schoolId, userId);
      if (!deleted) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase batch not found', callback);
        return;
      }

      ResponseBuilder.ok({ message: 'Purchase batch deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public restore = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await sportPurchaseBatchService.restoreBatch(batchId, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Deleted purchase not found', callback);
        return;
      }

      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public uploadBill = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body = JSON.parse(event.body);
      if (!body.fileName || !body.mimeType || !body.base64Data) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'fileName, mimeType, and base64Data are required', callback);
        return;
      }
      const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
      if (!allowed.includes(body.mimeType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `mimeType must be one of: ${allowed.join(', ')}`, callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await sportPurchaseBatchService.uploadBill(batchId, body, schoolId, userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase batch not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public getBill = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback); return; }

      const result = await sportPurchaseBatchService.getBill(batchId, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Bill not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public deleteBill = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      await sportPurchaseBatchService.deleteBill(batchId, schoolId, userId);
      ResponseBuilder.ok({ message: 'Bill deleted successfully' }, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new SportPurchaseBatchHandler();
export const createBulk = handler.createBulk;
export const list = handler.list;
export const getById = handler.getById;
export const update = handler.update;
export const remove = handler.remove;
export const restore = handler.restore;
export const uploadBill = handler.uploadBill;
export const getBill = handler.getBill;
export const deleteBill = handler.deleteBill;
