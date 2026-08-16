import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { studentService } from './student-service';
import { studentLookupService } from './student-lookup-service';
import { CreateLookupRequest, UpdateLookupRequest } from './student-interfaces';
import { LookupType } from './student-constants';
import { guard } from '../auth/authz';
import { STUDENT_ACTIONS } from './student-actions';

function userId(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

class StudentLookupHandler {
  private async resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await studentService.getSchoolIdByCode(schoolCode);
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
      const type = event.queryStringParameters?.type as LookupType | undefined;
      const results = await studentLookupService.list(type, schoolId, userId(event));
      ResponseBuilder.ok({ lookups: results }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public suggestByPincode = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const pincode = event.pathParameters?.pincode;
      if (!pincode) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Pincode is required', callback); return; }
      const result = await studentLookupService.suggestByPincode(pincode, schoolId);
      ResponseBuilder.ok({ suggestion: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: CreateLookupRequest = JSON.parse(event.body);
      const result = await studentLookupService.create(body, schoolId, userId(event));
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
      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Lookup ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: UpdateLookupRequest = JSON.parse(event.body);
      const result = await studentLookupService.update(id, body, schoolId, userId(event));
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Lookup not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Lookup ID is required', callback); return; }
      await studentLookupService.delete(id, schoolId, userId(event));
      ResponseBuilder.ok({ message: 'Lookup deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new StudentLookupHandler();
export const list = guard(STUDENT_ACTIONS['student-lookup-handler.list'], handler.list);
export const suggestByPincode = guard(STUDENT_ACTIONS['student-lookup-handler.suggestByPincode'], handler.suggestByPincode);
export const create = guard(STUDENT_ACTIONS['student-lookup-handler.create'], handler.create);
export const update = guard(STUDENT_ACTIONS['student-lookup-handler.update'], handler.update);
export const remove = guard(STUDENT_ACTIONS['student-lookup-handler.remove'], handler.remove);
