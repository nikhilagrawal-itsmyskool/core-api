import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { hiringCandidateService } from './hiring-candidate-service';
import { CreateCandidateRequest, UpdateCandidateRequest } from './hiring-interfaces';
import {
  CANDIDATE_STATUS_VALUES,
  FINAL_DECISION_VALUES,
  POSITION_TYPE_VALUES,
} from './hiring-constants';

class HiringCandidateHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: CreateCandidateRequest = JSON.parse(event.body);

      if (!body.name || !body.name.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'name is required', callback);
        return;
      }
      if (!body.positionType || !POSITION_TYPE_VALUES.includes(body.positionType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `positionType must be one of: ${POSITION_TYPE_VALUES.join(', ')}`, callback);
        return;
      }

      const userId = this.getUserId(event);
      const result = await hiringCandidateService.create(body, schoolId, userId);
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
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Candidate ID is required', callback);
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: UpdateCandidateRequest = JSON.parse(event.body);

      if (body.positionType && !POSITION_TYPE_VALUES.includes(body.positionType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `positionType must be one of: ${POSITION_TYPE_VALUES.join(', ')}`, callback);
        return;
      }
      if (body.status && !CANDIDATE_STATUS_VALUES.includes(body.status as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `status must be one of: ${CANDIDATE_STATUS_VALUES.join(', ')}`, callback);
        return;
      }
      if (body.finalDecision && !FINAL_DECISION_VALUES.includes(body.finalDecision as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `finalDecision must be one of: ${FINAL_DECISION_VALUES.join(', ')}`, callback);
        return;
      }

      const userId = this.getUserId(event);
      const result = await hiringCandidateService.update(id, body, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Candidate not found', callback);
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
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Candidate ID is required', callback);
        return;
      }

      const userId = this.getUserId(event);
      const deleted = await hiringCandidateService.delete(id, schoolId, userId);
      if (!deleted) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Candidate not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Candidate withdrawn successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Candidate ID is required', callback);
        return;
      }

      const result = await hiringCandidateService.getById(id, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Candidate not found', callback);
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
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;

      const q = event.queryStringParameters || {};

      const statusValues = q.status
        ? q.status.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      if (statusValues.length > 0 && statusValues.some((s: string) => !CANDIDATE_STATUS_VALUES.includes(s as any))) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `status must be one of: ${CANDIDATE_STATUS_VALUES.join(', ')}`, callback);
        return;
      }
      if (q.positionType && !POSITION_TYPE_VALUES.includes(q.positionType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `positionType must be one of: ${POSITION_TYPE_VALUES.join(', ')}`, callback);
        return;
      }

      const results = await hiringCandidateService.list({
        schoolId,
        status: statusValues.length > 0 ? statusValues : undefined,
        positionType: q.positionType,
        subject: q.subject,
        search: q.search,
      });

      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  private async resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await hiringCandidateService.getSchoolIdByCode(schoolCode);
    if (!schoolId) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
      return null;
    }
    return schoolId;
  }

  private getUserId(event: ApiEvent): string {
    return event.requestContext?.authorizer?.principalId || 'system';
  }
}

const handler = new HiringCandidateHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const getById = handler.getById;
export const list = handler.list;
