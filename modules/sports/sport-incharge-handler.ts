import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { sportService } from './sport-service';
import { sportInchargeService } from './sport-incharge-service';
import { SetInchargesRequest } from './sport-interfaces';
import { SPORT_TYPES } from './sport-constants';

const VALID_SPORT_TYPES = SPORT_TYPES.map((t) => t.value) as readonly string[];

class SportInchargeHandler {
  public list = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const results = await sportInchargeService.listAll(schoolId);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getBySport = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const sportType = event.pathParameters?.sportType;
      if (!sportType || !VALID_SPORT_TYPES.includes(sportType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid sport type. Must be one of: ${VALID_SPORT_TYPES.join(', ')}`, callback);
        return;
      }

      const results = await sportInchargeService.getBySport(schoolId, sportType);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public setForSport = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await sportService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const sportType = event.pathParameters?.sportType;
      if (!sportType || !VALID_SPORT_TYPES.includes(sportType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid sport type. Must be one of: ${VALID_SPORT_TYPES.join(', ')}`, callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: SetInchargesRequest = JSON.parse(event.body);

      if (!Array.isArray(body.inChargeIds)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'inChargeIds must be an array', callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';

      const results = await sportInchargeService.setForSport(schoolId, sportType, body.inChargeIds, userId);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SportInchargeHandler();
export const list = handler.list;
export const getBySport = handler.getBySport;
export const setForSport = handler.setForSport;
