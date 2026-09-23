import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { shopItemService } from './shop-item-service';
import { shopIntakeService } from './shop-intake-service';

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

class ShopIntakeHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const body = JSON.parse(event.body || '{}');
      if (!body.setId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'setId is required', callback); return; }
      if (!body.qtySets || body.qtySets < 1) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'qtySets (>= 1) is required', callback); return; }
      if (!body.intakeDate || !isValidDate(body.intakeDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'intakeDate is required (YYYY-MM-DD)', callback); return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await shopIntakeService.createIntake(body, schoolId, userId);
      if (!result) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Set not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const q = event.queryStringParameters || {};
      const results = await shopIntakeService.listIntakes(schoolId, {
        setId: q.setId,
        grade: q.grade,
        academicSession: q.academicSession,
      });
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await shopItemService.getSchoolIdByCode(schoolCode);
      if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Intake ID is required', callback); return; }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const deleted = await shopIntakeService.deleteIntake(id, schoolId, userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Intake not found', callback); return; }
      ResponseBuilder.ok({ message: 'Intake deleted' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ShopIntakeHandler();
export const create = handler.create;
export const list = handler.list;
export const remove = handler.remove;
