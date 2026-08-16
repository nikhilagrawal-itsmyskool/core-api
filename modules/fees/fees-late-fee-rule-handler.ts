import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guard } from '../auth/authz';
import { FEE_ACTIONS } from './fees-actions';
import { resolveSchool, parseBody, requireParam } from './fees-util';
import { lateFeeRuleService, CreateLateFeeRuleRequest, UpdateLateFeeRuleRequest } from './fees-late-fee-rule-service';
import { applyFineService } from './fees-apply-fine-service';

class LateFeeRuleHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateLateFeeRuleRequest>(event, callback);
      if (!body) return;
      const result = await lateFeeRuleService.create(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<UpdateLateFeeRuleRequest>(event, callback);
      if (!body) return;
      const result = await lateFeeRuleService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Late fee rule not found', callback);
        return;
      }
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
      const result = await lateFeeRuleService.remove(id, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Late fee rule not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Late fee rule deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const academicYearId = event.queryStringParameters?.academicYearId;
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';
      const results = await lateFeeRuleService.list(ctx.schoolId, academicYearId, includeDeleted);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Preview (dry-run) what the Apply-Fine job would levy right now — used by the settings screen.
  public applyPreview = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<any>(event, callback) || {};
      const academicYearId = body.academicYearId || event.queryStringParameters?.academicYearId;
      if (!academicYearId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId is required', callback); return; }
      const result = await applyFineService.run(ctx.schoolId, academicYearId, { asOf: body.asOf, dryRun: true, userId: ctx.userId });
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Run the Apply-Fine job on-demand (persists). Nightly cron does this automatically.
  public applyRun = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<any>(event, callback) || {};
      const academicYearId = body.academicYearId || event.queryStringParameters?.academicYearId;
      if (!academicYearId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId is required', callback); return; }
      const result = await applyFineService.run(ctx.schoolId, academicYearId, { asOf: body.asOf, dryRun: false, userId: ctx.userId });
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // EventBridge nightly trigger — runs for every school+year with an enabled rule. No HTTP context.
  public nightly = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const results = await applyFineService.runAllEnabled({});
      console.log('[apply-fine nightly]', JSON.stringify(results));
      if (callback) callback(null, { ok: true, results } as any);
    } catch (err: any) {
      console.error('[apply-fine nightly] failed', err);
      if (callback) callback(null, { ok: false, error: err.message } as any);
    }
  };
}

const handler = new LateFeeRuleHandler();
export const create = guard(FEE_ACTIONS['fees-late-fee-rule-handler.create'], handler.create);
export const update = guard(FEE_ACTIONS['fees-late-fee-rule-handler.update'], handler.update);
export const remove = guard(FEE_ACTIONS['fees-late-fee-rule-handler.remove'], handler.remove);
export const list = guard(FEE_ACTIONS['fees-late-fee-rule-handler.list'], handler.list);
export const applyPreview = guard(FEE_ACTIONS['fees-late-fee-rule-handler.applyPreview'], handler.applyPreview);
export const applyRun = guard(FEE_ACTIONS['fees-late-fee-rule-handler.applyRun'], handler.applyRun);
export const nightly = handler.nightly; // schedule event — no caller, ungated
