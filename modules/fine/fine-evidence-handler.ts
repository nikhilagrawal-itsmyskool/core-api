import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { fineIncidentService } from './fine-incident-service';
import { fineEvidenceService } from './fine-evidence-service';
import { UploadEvidenceRequest } from './fine-interfaces';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

class FineEvidenceHandler {
  public upload = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await fineIncidentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const incidentId = event.pathParameters?.id;
      if (!incidentId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Incident ID is required', callback);
        return;
      }

      const incident = await fineIncidentService.getByIdSimple(incidentId, schoolId);
      if (!incident) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Incident not found', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: UploadEvidenceRequest = JSON.parse(event.body);

      if (!body.fileName) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'fileName is required', callback);
        return;
      }
      if (!body.mimeType) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'mimeType is required', callback);
        return;
      }
      if (!ALLOWED_MIME_TYPES.includes(body.mimeType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `mimeType must be one of: ${ALLOWED_MIME_TYPES.join(', ')}`, callback);
        return;
      }
      if (!body.base64Data) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'base64Data is required', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await fineEvidenceService.upload(incidentId, body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public get = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await fineIncidentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const evidenceId = event.pathParameters?.evidenceId;
      if (!evidenceId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Evidence ID is required', callback);
        return;
      }

      const result = await fineEvidenceService.getWithData(evidenceId, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Evidence not found', callback);
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
      const schoolId = await fineIncidentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const evidenceId = event.pathParameters?.evidenceId;
      if (!evidenceId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Evidence ID is required', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const deleted = await fineEvidenceService.delete(evidenceId, schoolId, userId);
      if (!deleted) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Evidence not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Evidence deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new FineEvidenceHandler();
export const upload = handler.upload;
export const get = handler.get;
export const remove = handler.remove;
