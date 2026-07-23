import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { assemblyWeekService } from './assembly-week-service';
import { EnsureWeekRequest, SaveRosterRequest, UnlockWeekRequest } from './assembly-interfaces';

class AssemblyWeekHandler {
  // POST /plans/{id}/weeks  { weekStart } — ensure (idempotent) a draft roster week.
  public ensure = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const planId = requireParam(event, 'id', callback); if (!planId) return;
      const body = parseBody<EnsureWeekRequest>(event, callback); if (!body) return;
      if (!body.weekStart) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'weekStart is required', callback); return; }
      ResponseBuilder.ok(await assemblyWeekService.ensureWeek(planId, body.weekStart, ctx.schoolId, ctx.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /plans/{id}/weeks?from=&to= — week summaries in a range.
  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const planId = requireParam(event, 'id', callback); if (!planId) return;
      const q = event.queryStringParameters || {};
      const today = new Date().toISOString().slice(0, 10);
      const from = q.from || today;
      const to = q.to || new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
      ResponseBuilder.ok(await assemblyWeekService.listWeeks(planId, ctx.schoolId, from, to), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /weeks/{id} — the roster editor read model (week + days + fillable slots).
  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const result = await assemblyWeekService.getWeek(id, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // PUT /weeks/{id}/roster — bulk save days/entries (replace-per-kind).
  public saveRoster = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const body = parseBody<SaveRosterRequest>(event, callback); if (!body) return;
      const result = await assemblyWeekService.saveRoster(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public submit = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const result = await assemblyWeekService.submit(id, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public approve = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const result = await assemblyWeekService.approve(id, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public lock = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const result = await assemblyWeekService.lock(id, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public unlock = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const body = (event.body ? parseBody<UnlockWeekRequest>(event, callback) : {}) as UnlockWeekRequest | null;
      if (body === null) return;
      const result = await assemblyWeekService.unlock(id, body.reason, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new AssemblyWeekHandler();
export const ensure = handler.ensure;
export const list = handler.list;
export const getById = handler.getById;
export const saveRoster = handler.saveRoster;
export const submit = handler.submit;
export const approve = handler.approve;
export const lock = handler.lock;
export const unlock = handler.unlock;
