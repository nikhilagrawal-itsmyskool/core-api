import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { guard } from '../auth/authz';
import { employeeService } from './employee-service';
import { employeePhotoService } from './employee-photo-service';
import { UploadPhotoRequest } from './employee-interfaces';
import { EMPLOYEE_ACTIONS } from './employee-actions';

// Employee photos (entity_type fixed to 'employee'), mirroring the student photo surface.
class EmployeePhotoHandler {
  private async resolveSchoolId(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
    const schoolId = await employeeService.getSchoolIdByCode(validateSchoolCodeHeader(event));
    if (!schoolId) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
      return null;
    }
    return schoolId;
  }

  private userId(event: ApiEvent): string {
    return event.requestContext?.authorizer?.principalId || 'system';
  }

  // POST /photos/{id}  body { fileName, mimeType, base64Data }  ?variant=
  public upload = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Employee ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: UploadPhotoRequest = JSON.parse(event.body);
      body.variant = event.queryStringParameters?.variant || body.variant;
      const result = await employeePhotoService.upload(id, body, schoolId, this.userId(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /photos/{id}?variant=
  public get = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Employee ID is required', callback); return; }
      const result = await employeePhotoService.getLatestWithData(id, schoolId, event.queryStringParameters?.variant || 'original');
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Photo not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /photos/{id}?variant=
  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Employee ID is required', callback); return; }
      const variant = event.queryStringParameters?.variant;
      const count = variant
        ? await employeePhotoService.deleteVariant(id, schoolId, variant)
        : await employeePhotoService.deleteAll(id, schoolId);
      ResponseBuilder.ok({ message: 'Photo deleted', deleted: count }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new EmployeePhotoHandler();
export const upload = guard(EMPLOYEE_ACTIONS['employee-photo-handler.upload'], handler.upload);
export const get = guard(EMPLOYEE_ACTIONS['employee-photo-handler.get'], handler.get);
export const remove = guard(EMPLOYEE_ACTIONS['employee-photo-handler.remove'], handler.remove);
