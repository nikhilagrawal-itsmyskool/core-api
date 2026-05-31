import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { shopItemService } from './shop-item-service';
import { shopStatsService } from './shop-stats-service';

export const getStats = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
  _context.callbackWaitsForEmptyEventLoop = false;
  try {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
    if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

    const result = await shopStatsService.getStats(schoolId);
    ResponseBuilder.ok(result, callback);
  } catch (err: any) {
    ResponseBuilder.handleError(err, callback);
  }
};
