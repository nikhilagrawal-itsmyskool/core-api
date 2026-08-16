import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { studentService } from './student-service';
import { studentPhotoService } from './student-photo-service';
import { UploadPhotoRequest } from './student-interfaces';
import { guard } from '../auth/authz';
import { STUDENT_ACTIONS } from './student-actions';

function userId(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

class StudentPhotoHandler {
  private async resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await studentService.getSchoolIdByCode(schoolCode);
    if (!schoolId) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
      return null;
    }
    return schoolId;
  }

  // POST /photos/{entityType}/{entityId}  body { fileName, mimeType, base64Data }
  public upload = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const entityType = event.pathParameters?.entityType;
      const entityId = event.pathParameters?.entityId;
      if (!entityType || !entityId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'entityType and entityId are required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: UploadPhotoRequest = JSON.parse(event.body);
      body.variant = event.queryStringParameters?.variant || body.variant;
      const result = await studentPhotoService.upload(entityType, entityId, body, schoolId, userId(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /photos/{entityType}/{entityId}
  public get = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const entityType = event.pathParameters?.entityType;
      const entityId = event.pathParameters?.entityId;
      if (!entityType || !entityId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'entityType and entityId are required', callback); return; }

      const variant = event.queryStringParameters?.variant || 'original';
      const result = await studentPhotoService.getLatestWithData(entityType, entityId, schoolId, variant);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Photo not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /photos/{entityType}/{entityId}
  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const entityType = event.pathParameters?.entityType;
      const entityId = event.pathParameters?.entityId;
      if (!entityType || !entityId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'entityType and entityId are required', callback); return; }

      const variant = event.queryStringParameters?.variant;
      const count = variant
        ? await studentPhotoService.deleteVariant(entityType, entityId, schoolId, variant)
        : await studentPhotoService.deleteAll(entityType, entityId, schoolId);
      ResponseBuilder.ok({ message: 'Photo deleted', deleted: count }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new StudentPhotoHandler();
export const upload = guard(STUDENT_ACTIONS['student-photo-handler.upload'], handler.upload);
export const get = guard(STUDENT_ACTIONS['student-photo-handler.get'], handler.get);
export const remove = guard(STUDENT_ACTIONS['student-photo-handler.remove'], handler.remove);
