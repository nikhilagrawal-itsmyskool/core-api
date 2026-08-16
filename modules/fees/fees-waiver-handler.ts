import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guard } from '../auth/authz';
import { FEE_ACTIONS } from './fees-actions';
import { resolveSchool, parseBody, requireParam } from './fees-util';
import { waiverService, CreateWaiverRequest } from './fees-waiver-service';

class WaiverHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateWaiverRequest>(event, callback);
      if (!body) return;
      const result = await waiverService.create(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const result = await waiverService.remove(id, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Waiver not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Waiver deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const studentId = event.queryStringParameters?.studentId;
      const academicYearId = event.queryStringParameters?.academicYearId;
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';
      const results = await waiverService.list(ctx.schoolId, studentId, academicYearId, includeDeleted);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new WaiverHandler();
export const create = guard(FEE_ACTIONS['fees-waiver-handler.create'], handler.create);
export const remove = guard(FEE_ACTIONS['fees-waiver-handler.remove'], handler.remove);
export const list = guard(FEE_ACTIONS['fees-waiver-handler.list'], handler.list);
