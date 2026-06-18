import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { medicalItemService } from './medical-item-service';
import { medicalPurchaseBatchService } from './medical-purchase-batch-service';
import {
  CreateBulkPurchaseRequest,
  UpdatePurchaseBatchRequest,
  UploadBillRequest,
  ExpiringPurchase,
} from './medical-interfaces';
import { isValidDate, getDefaultStartDate, getDefaultEndDate } from '../../shared/util/datetime';

const ALLOWED_BILL_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

class MedicalPurchaseBatchHandler {
  public createBulk = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: CreateBulkPurchaseRequest = JSON.parse(event.body);

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
        if (!item.quantity || item.quantity <= 0) {
          ResponseBuilder.badRequest(
            ErrorCode.InvalidInput,
            `items[${i}].quantity must be greater than 0`,
            callback
          );
          return;
        }
      }

      if (body.bill) {
        if (!body.bill.fileName || !body.bill.mimeType || !body.bill.base64Data) {
          ResponseBuilder.badRequest(
            ErrorCode.InvalidInput,
            'bill must include fileName, mimeType, and base64Data',
            callback
          );
          return;
        }
        if (!ALLOWED_BILL_MIME_TYPES.includes(body.bill.mimeType)) {
          ResponseBuilder.badRequest(
            ErrorCode.InvalidInput,
            `bill mimeType must be one of: ${ALLOWED_BILL_MIME_TYPES.join(', ')}`,
            callback
          );
          return;
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await medicalPurchaseBatchService.createBulk(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const startDate = event.queryStringParameters?.startDate || getDefaultStartDate();
      const endDate = event.queryStringParameters?.endDate || getDefaultEndDate();
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';
      const itemId = event.queryStringParameters?.itemId;

      if (!isValidDate(startDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid startDate format. Use YYYY-MM-DD', callback);
        return;
      }
      if (!isValidDate(endDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid endDate format. Use YYYY-MM-DD', callback);
        return;
      }

      const results = await medicalPurchaseBatchService.listBatches({
        schoolId,
        startDate,
        endDate,
        includeDeleted,
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback);
        return;
      }

      const result = await medicalPurchaseBatchService.getBatchById(batchId, schoolId);
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
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

      const body: UpdatePurchaseBatchRequest = JSON.parse(event.body);

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
          if (!item.quantity || item.quantity <= 0) {
            ResponseBuilder.badRequest(ErrorCode.InvalidInput, `items[${i}].quantity must be greater than 0`, callback);
            return;
          }
        }
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await medicalPurchaseBatchService.update(batchId, body, schoolId, userId);
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
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
      const deleted = await medicalPurchaseBatchService.deleteBatch(batchId, schoolId, userId);
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
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
      const result = await medicalPurchaseBatchService.restoreBatch(batchId, schoolId, userId);
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
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
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

      const body: UploadBillRequest = JSON.parse(event.body);

      if (!body.fileName || !body.mimeType || !body.base64Data) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          'fileName, mimeType, and base64Data are required',
          callback
        );
        return;
      }

      if (!ALLOWED_BILL_MIME_TYPES.includes(body.mimeType)) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          `mimeType must be one of: ${ALLOWED_BILL_MIME_TYPES.join(', ')}`,
          callback
        );
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await medicalPurchaseBatchService.uploadBill(batchId, body, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase batch not found', callback);
        return;
      }

      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getBill = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const batchId = event.pathParameters?.batchId;
      if (!batchId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Batch ID is required', callback);
        return;
      }

      const result = await medicalPurchaseBatchService.getBill(batchId, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Bill not found', callback);
        return;
      }

      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public deleteBill = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
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

      // Check batch exists first
      const batch = await medicalPurchaseBatchService.getBatchById(batchId, schoolId);
      if (!batch) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Purchase batch not found', callback);
        return;
      }

      await medicalPurchaseBatchService.deleteBill(batchId, schoolId, userId);
      ResponseBuilder.ok({ message: 'Bill deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
  public listExpiring = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await medicalItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const daysParam = event.queryStringParameters?.days;
      const days = daysParam ? parseInt(daysParam, 10) : 60;
      if (isNaN(days) || days <= 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'days must be a positive integer', callback);
        return;
      }

      const items: ExpiringPurchase[] = await medicalPurchaseBatchService.listExpiring(schoolId, days);
      ResponseBuilder.ok({ items }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new MedicalPurchaseBatchHandler();
export const createBulk = handler.createBulk;
export const list = handler.list;
export const getById = handler.getById;
export const update = handler.update;
export const remove = handler.remove;
export const restore = handler.restore;
export const uploadBill = handler.uploadBill;
export const getBill = handler.getBill;
export const deleteBill = handler.deleteBill;
export const listExpiring = handler.listExpiring;
