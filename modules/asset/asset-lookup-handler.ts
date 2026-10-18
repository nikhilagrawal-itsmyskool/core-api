import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { assetTypeService } from './asset-type-service';
import { ASSET_CONDITIONS, ASSET_STATUSES, ASSET_KINDS } from './asset-constants';
import { guard } from '../auth/authz';
import { ASSET_ACTIONS } from './asset-actions';

class AssetLookupHandler {
  // Asset types are per-school managed data (seeded on first use), not a static enum.
  public getTypes = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await assetTypeService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }
      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const types = await assetTypeService.list(schoolId, userId);
      ResponseBuilder.ok({ types }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getConditions = (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({ conditions: ASSET_CONDITIONS }, callback);
  };

  public getStatuses = (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({ statuses: ASSET_STATUSES }, callback);
  };

  public getKinds = (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({ kinds: ASSET_KINDS }, callback);
  };
}

const handler = new AssetLookupHandler();
const g = (ref: string, fn: any) => guard(ASSET_ACTIONS[ref], fn);
export const getTypes = g('asset-lookup-handler.getTypes', handler.getTypes);
export const getConditions = g('asset-lookup-handler.getConditions', handler.getConditions);
export const getStatuses = g('asset-lookup-handler.getStatuses', handler.getStatuses);
export const getKinds = g('asset-lookup-handler.getKinds', handler.getKinds);
