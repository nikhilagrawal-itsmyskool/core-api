import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guard } from '../auth/authz';
import { FEE_ACTIONS } from './fees-actions';
import { resolveSchool, parseBody, requireParam } from './fees-util';
import { feesLedgerService } from './fees-ledger-service';
import { summary as feesMeSummary } from './fees-me-handler';

class FeesLedgerHandler {
  public studentLedger = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const studentId = requireParam(event, 'id', callback); if (!studentId) return;
      const academicYearId = event.queryStringParameters?.academicYearId;
      const includeCancelled = event.queryStringParameters?.includeCancelled === 'true';
      const result = await feesLedgerService.studentLedger(rc.schoolId, studentId, academicYearId, includeCancelled);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public studentSummary = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const studentId = requireParam(event, 'id', callback); if (!studentId) return;
      const academicYearId = event.queryStringParameters?.academicYearId;
      const result = await feesLedgerService.studentSummary(rc.schoolId, studentId, academicYearId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public chargeRun = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const body = parseBody<any>(event, callback); if (!body) return;
      const result = await feesLedgerService.chargeRun(rc.schoolId, body, rc.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new FeesLedgerHandler();
export const studentLedger = guard(FEE_ACTIONS['fees-ledger-handler.studentLedger'], handler.studentLedger);

// students/{id}/summary. With id='me' it serves the parent app's active child
// (guardActiveStudent inside feesMeSummary) and bypasses the admin guard; any other
// id stays the admin-guarded summary. Sharing this route avoids a new CFN resource.
const guardedSummary = guard(FEE_ACTIONS['fees-ledger-handler.studentSummary'], handler.studentSummary);
export const studentSummary = (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) =>
  event.pathParameters?.id === 'me'
    ? feesMeSummary(event, ctx, callback)
    : guardedSummary(event, ctx, callback);

export const chargeRun = guard(FEE_ACTIONS['fees-ledger-handler.chargeRun'], handler.chargeRun);
