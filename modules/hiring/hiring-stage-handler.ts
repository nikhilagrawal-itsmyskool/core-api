import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { hiringCandidateService } from './hiring-candidate-service';
import { hiringStageService } from './hiring-stage-service';
import { CreateStageRequest, UpdateStageRequest } from './hiring-interfaces';
import { STAGE_OUTCOME_VALUES, STAGE_TYPE_VALUES } from './hiring-constants';
import { isValidDate } from '../../shared/util/datetime';

class HiringStageHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await this.resolve(event, callback);
      if (!ctx) return;
      const { schoolId, candidateId, userId } = ctx;

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: CreateStageRequest = JSON.parse(event.body);

      if (!body.stageType || !STAGE_TYPE_VALUES.includes(body.stageType as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `stageType must be one of: ${STAGE_TYPE_VALUES.join(', ')}`, callback);
        return;
      }
      if (body.outcome && !STAGE_OUTCOME_VALUES.includes(body.outcome as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `outcome must be one of: ${STAGE_OUTCOME_VALUES.join(', ')}`, callback);
        return;
      }
      if (body.scheduledDate && !isValidDate(body.scheduledDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid scheduledDate format. Use YYYY-MM-DD', callback);
        return;
      }

      const result = await hiringStageService.create(candidateId, body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await this.resolve(event, callback);
      if (!ctx) return;
      const { schoolId, userId } = ctx;

      const stageId = event.pathParameters?.stageId;
      if (!stageId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Stage ID is required', callback);
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: UpdateStageRequest = JSON.parse(event.body);

      if (body.outcome && !STAGE_OUTCOME_VALUES.includes(body.outcome as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `outcome must be one of: ${STAGE_OUTCOME_VALUES.join(', ')}`, callback);
        return;
      }
      if (body.scheduledDate && !isValidDate(body.scheduledDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid scheduledDate format. Use YYYY-MM-DD', callback);
        return;
      }

      const result = await hiringStageService.update(stageId, body, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Stage not found', callback);
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
      const { schoolId } = ctx;

      const stageId = event.pathParameters?.stageId;
      if (!stageId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Stage ID is required', callback);
        return;
      }

      const deleted = await hiringStageService.delete(stageId, schoolId);
      if (!deleted) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Stage not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Stage deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Resolve school + candidate + user, validating the candidate exists.
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

const handler = new HiringStageHandler();
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
