import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guard } from '../auth/authz';
import { resolveSchool } from '../fees/fees-util';
import { feesReportService } from '../fees/fees-report-service';
import { FEE_EXT_ACTIONS } from './fees-ext-actions';

// fees-ext service handlers. This second stack exists only because the primary `fees` service is
// at CloudFormation's 500-resource limit; the business logic lives in the fees module
// (feesReportService) and is imported here, so there is a single source of truth.
class FeesExtHandler {
  // POST /fees-ext/students/{id}/write-off — mark/lift a student's dues as bad debt (body: {action, reason}).
  public writeOff = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const id = event.pathParameters?.id as string;
      const result = await feesReportService.writeOff(rc.schoolId, id, JSON.parse(event.body || '{}'), rc.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /fees-ext/students/{id}/followup?academicYearId= — a student's call-log timeline.
  public getFollowup = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const q = { ...(event.queryStringParameters || {}), studentId: event.pathParameters?.id };
      const result = await feesReportService.getFollowup(rc.schoolId, q);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /fees-ext/students/{id}/followup — log a call outcome (body: {academicYearId, status, note, promisedDate}).
  public setFollowup = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const body = { ...JSON.parse(event.body || '{}'), studentId: event.pathParameters?.id };
      const result = await feesReportService.setFollowup(rc.schoolId, body, rc.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /fees-ext/reports/followup-activity?days= — call-activity report (admin oversight).
  public followupActivity = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesReportService.followupActivity(rc.schoolId, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new FeesExtHandler();
export const writeOff = guard(FEE_EXT_ACTIONS['fees-ext-handler.writeOff'], handler.writeOff);
export const getFollowup = guard(FEE_EXT_ACTIONS['fees-ext-handler.getFollowup'], handler.getFollowup);
export const setFollowup = guard(FEE_EXT_ACTIONS['fees-ext-handler.setFollowup'], handler.setFollowup);
export const followupActivity = guard(FEE_EXT_ACTIONS['fees-ext-handler.followupActivity'], handler.followupActivity);
