import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { resolveSchool } from './fees-util';
import { feesReportService } from './fees-report-service';

class FeesReportHandler {
  public dailyCollection = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesReportService.dailyCollection(rc.schoolId, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public overview = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesReportService.overview(rc.schoolId, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new FeesReportHandler();
export const dailyCollection = handler.dailyCollection;
export const overview = handler.overview;
