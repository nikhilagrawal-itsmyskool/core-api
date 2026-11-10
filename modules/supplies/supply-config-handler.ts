import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { supplyService } from './supply-service';
import { guard } from '../auth/authz';
import { SUPPLY_ACTIONS } from './supply-actions';

// Per-school supplies module settings. getConfig = inventory.view, updateConfig =
// inventory.manage (mirrors the uniform config pattern — no dedicated config action).
class SupplyConfigHandler {
  public getConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }
      const result = await supplyService.getConfig(schoolId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await supplyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body = JSON.parse(event.body) as { hideSeededItems?: boolean };
      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await supplyService.updateConfig(schoolId, body, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SupplyConfigHandler();
const g = (ref: string, fn: any) => guard(SUPPLY_ACTIONS[ref], fn);
export const getConfig = g('supply-config-handler.getConfig', handler.getConfig);
export const updateConfig = g('supply-config-handler.updateConfig', handler.updateConfig);
