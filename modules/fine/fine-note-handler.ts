import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { fineIncidentService } from './fine-incident-service';
import { fineNoteService } from './fine-note-service';
import { CreateNoteRequest } from './fine-interfaces';
import { PERSON_TYPES } from './fine-constants';
import { guard } from '../auth/authz';
import { FINE_ACTIONS } from './fine-actions';

class FineNoteHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
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

      const body: CreateNoteRequest = JSON.parse(event.body);

      if (!body.noteText || !body.noteText.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'noteText is required', callback);
        return;
      }
      if (body.authorType && !PERSON_TYPES.includes(body.authorType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `authorType must be one of: ${PERSON_TYPES.join(', ')}`, callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await fineNoteService.create(incidentId, body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
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

      const results = await fineNoteService.list(incidentId, schoolId);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new FineNoteHandler();
const g = (ref: string, fn: any) => guard(FINE_ACTIONS[ref], fn);
export const create = g('fine-note-handler.create', handler.create);
export const list = g('fine-note-handler.list', handler.list);
