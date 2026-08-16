import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guard } from '../auth/authz';
import { FEE_ACTIONS } from './fees-actions';
import { resolveSchool, parseBody, requireParam } from './fees-util';
import { feesLedgerService } from './fees-ledger-service';

class FeesLedgerHandler {
  public studentLedger = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const studentId = requireParam(event, 'id', callback); if (!studentId) return;
      const academicYearId = event.queryStringParameters?.academicYearId;
      const result = await feesLedgerService.studentLedger(rc.schoolId, studentId, academicYearId);
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
export const studentSummary = guard(FEE_ACTIONS['fees-ledger-handler.studentSummary'], handler.studentSummary);
export const chargeRun = guard(FEE_ACTIONS['fees-ledger-handler.chargeRun'], handler.chargeRun);
