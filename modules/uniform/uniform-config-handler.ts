import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { uniformItemService } from './uniform-item-service';
import { UniformConfig } from './uniform-interfaces';
import { guard } from '../auth/authz';
import { UNIFORM_ACTIONS } from './uniform-actions';

class UniformConfigHandler {
  public getConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }
      ResponseBuilder.ok(await uniformItemService.getConfig(schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }
      const body: Partial<UniformConfig> = JSON.parse(event.body || '{}');
      const userId = event.requestContext?.authorizer?.principalId || 'system';
      ResponseBuilder.ok(await uniformItemService.updateConfig(schoolId, body, userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new UniformConfigHandler();
const g = (ref: string, fn: any) => guard(UNIFORM_ACTIONS[ref], fn);
export const getConfig = g('uniform-config-handler.getConfig', handler.getConfig);
export const updateConfig = g('uniform-config-handler.updateConfig', handler.updateConfig);
