import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { guard } from '../auth/authz';
import { TRANSFER_ACTIONS } from './transfer-actions';
import { getSchoolIdByCode } from './transfer-common';
import { transferService } from './transfer-service';
import { CreateTcRequest, UpdateTcRequest } from './transfer-interfaces';

function userId(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

class TransferHandler {
  private async resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await getSchoolIdByCode(schoolCode);
    if (!schoolId) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
      return null;
    }
    return schoolId;
  }

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const studentId = event.pathParameters?.id;
      if (!studentId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Student ID is required', callback); return; }
      const results = await transferService.listForStudent(studentId, schoolId);
      ResponseBuilder.ok({ tcs: results }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /transfer/tc?query=&status= — school-wide TC list/search.
  public listAll = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const q = event.queryStringParameters || {};
      const results = await transferService.listAll(schoolId, { query: q.query, status: q.status });
      ResponseBuilder.ok({ tcs: results }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const studentId = event.pathParameters?.id;
      if (!studentId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Student ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: CreateTcRequest = JSON.parse(event.body);
      const result = await transferService.create(studentId, body, schoolId, userId(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const tcId = event.pathParameters?.tcId;
      if (!tcId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'TC ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: UpdateTcRequest = JSON.parse(event.body);
      const result = await transferService.update(tcId, body, schoolId, userId(event));
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'TC not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new TransferHandler();
export const list = guard(TRANSFER_ACTIONS['transfer-handler.list'], handler.list);
export const listAll = guard(TRANSFER_ACTIONS['transfer-handler.listAll'], handler.listAll);
export const create = guard(TRANSFER_ACTIONS['transfer-handler.create'], handler.create);
export const update = guard(TRANSFER_ACTIONS['transfer-handler.update'], handler.update);
