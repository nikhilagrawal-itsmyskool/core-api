import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { fineIncidentService } from './fine-incident-service';
import { CreateIncidentRequest, UpdateIncidentRequest } from './fine-interfaces';
import {
  CATEGORY_VALUES,
  PERSON_TYPES,
  STATUS_VALUES,
  DECISION_VALUES,
  VALID_STATUS_TRANSITIONS,
} from './fine-constants';
import { isValidDate } from '../../shared/util/datetime';

class FineIncidentHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await fineIncidentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: CreateIncidentRequest = JSON.parse(event.body);

      if (!body.incidentDate) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'incidentDate is required', callback);
        return;
      }
      if (!isValidDate(body.incidentDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid incidentDate format. Use YYYY-MM-DD', callback);
        return;
      }
      if (!body.category || !CATEGORY_VALUES.includes(body.category as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `category must be one of: ${CATEGORY_VALUES.join(', ')}`, callback);
        return;
      }
      if (!body.personType || !PERSON_TYPES.includes(body.personType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `personType must be one of: ${PERSON_TYPES.join(', ')}`, callback);
        return;
      }
      if (!body.personId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'personId is required', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await fineIncidentService.create(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await fineIncidentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Incident ID is required', callback);
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: UpdateIncidentRequest = JSON.parse(event.body);

      if (body.incidentDate && !isValidDate(body.incidentDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid incidentDate format. Use YYYY-MM-DD', callback);
        return;
      }
      if (body.category && !CATEGORY_VALUES.includes(body.category as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `category must be one of: ${CATEGORY_VALUES.join(', ')}`, callback);
        return;
      }
      if (body.decision && !DECISION_VALUES.includes(body.decision as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `decision must be one of: ${DECISION_VALUES.join(', ')}`, callback);
        return;
      }
      if (body.decision === 'collect' && body.decidedFineAmount === undefined) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'decidedFineAmount is required when decision is collect', callback);
        return;
      }
      if (body.status && !STATUS_VALUES.includes(body.status as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `status must be one of: ${STATUS_VALUES.join(', ')}`, callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const result = await fineIncidentService.update(id, body, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Incident not found', callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      if (err.message?.startsWith('Invalid status transition')) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, err.message, callback);
        return;
      }
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

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Incident ID is required', callback);
        return;
      }

      const existing = await fineIncidentService.getByIdSimple(id, schoolId);
      if (!existing) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Incident not found', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      await fineIncidentService.delete(id, schoolId, userId);
      ResponseBuilder.ok({ message: 'Incident deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await fineIncidentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Incident ID is required', callback);
        return;
      }

      const result = await fineIncidentService.getById(id, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Incident not found', callback);
        return;
      }
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

      const q = event.queryStringParameters || {};

      const statusValues = q.status ? q.status.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      if (statusValues.length > 0 && statusValues.some((s: string) => !STATUS_VALUES.includes(s as any))) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `status must be one of: ${STATUS_VALUES.join(', ')}`, callback);
        return;
      }
      if (q.category && !CATEGORY_VALUES.includes(q.category as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `category must be one of: ${CATEGORY_VALUES.join(', ')}`, callback);
        return;
      }
      if (q.startDate && !isValidDate(q.startDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid startDate format. Use YYYY-MM-DD', callback);
        return;
      }
      if (q.endDate && !isValidDate(q.endDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid endDate format. Use YYYY-MM-DD', callback);
        return;
      }

      const results = await fineIncidentService.list({
        schoolId,
        status: statusValues.length > 0 ? statusValues : undefined,
        category: q.category,
        personType: q.personType,
        personId: q.personId,
        assignedToId: q.assignedToId,
        startDate: q.startDate,
        endDate: q.endDate,
        search: q.search,
      });

      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new FineIncidentHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const list = handler.list;
