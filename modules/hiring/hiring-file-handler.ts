import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { hiringCandidateService } from './hiring-candidate-service';
import { hiringFileService } from './hiring-file-service';
import { UploadFileRequest } from './hiring-interfaces';
import { FILE_KINDS, FileKind, PHOTO_MIME_TYPES, RESUME_MIME_TYPES } from './hiring-constants';

class HiringFileHandler {
  public upload = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await this.resolve(event, callback);
      if (!ctx) return;
      const { schoolId, candidateId, userId } = ctx;

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: UploadFileRequest = JSON.parse(event.body);

      if (!body.kind || !FILE_KINDS.includes(body.kind as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `kind must be one of: ${FILE_KINDS.join(', ')}`, callback);
        return;
      }
      if (!body.fileName) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'fileName is required', callback);
        return;
      }
      if (!body.mimeType) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'mimeType is required', callback);
        return;
      }
      if (!body.base64Data) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'base64Data is required', callback);
        return;
      }

      const allowed = body.kind === 'photo' ? PHOTO_MIME_TYPES : RESUME_MIME_TYPES;
      if (!allowed.includes(body.mimeType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `mimeType for ${body.kind} must be one of: ${allowed.join(', ')}`, callback);
        return;
      }

      const result = await hiringFileService.upload(candidateId, body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public get = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await hiringCandidateService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const fileId = event.pathParameters?.fileId;
      if (!fileId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'File ID is required', callback);
        return;
      }

      const result = await hiringFileService.getWithData(fileId, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'File not found', callback);
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
      const ctx = await this.resolve(event, callback);
      if (!ctx) return;
      const { schoolId, candidateId, userId } = ctx;

      const kind = event.pathParameters?.kind as FileKind | undefined;
      if (!kind || !FILE_KINDS.includes(kind as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `kind must be one of: ${FILE_KINDS.join(', ')}`, callback);
        return;
      }

      const deleted = await hiringFileService.delete(candidateId, kind, schoolId, userId);
      if (!deleted) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'File not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'File deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  private async resolve(
    event: ApiEvent,
    callback: ApiCallback
  ): Promise<{ schoolId: string; candidateId: string; userId: string } | null> {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await hiringCandidateService.getSchoolIdByCode(schoolCode);
    if (!schoolId) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
      return null;
    }

    const candidateId = event.pathParameters?.id;
    if (!candidateId) {
      ResponseBuilder.badRequest(ErrorCode.MissingId, 'Candidate ID is required', callback);
      return null;
    }

    const candidate = await hiringCandidateService.getByIdSimple(candidateId, schoolId);
    if (!candidate) {
      ResponseBuilder.notFound(ErrorCode.InvalidId, 'Candidate not found', callback);
      return null;
    }

    const userId = event.requestContext?.authorizer?.principalId || 'system';
    return { schoolId, candidateId, userId };
  }
}

const handler = new HiringFileHandler();
export const upload = handler.upload;
export const get = handler.get;
export const remove = handler.remove;
