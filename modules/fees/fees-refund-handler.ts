import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { resolveSchool, parseBody } from './fees-util';
import { feesRefundService } from './fees-refund-service';

class FeesRefundHandler {
  public create = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const body = parseBody<any>(event, callback); if (!body) return;
      const result = await feesRefundService.create(rc.schoolId, body, rc.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public list = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesRefundService.list(rc.schoolId, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new FeesRefundHandler();
export const create = handler.create;
export const list = handler.list;
