import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { assemblyChecklistService } from './assembly-checklist-service';
import { CreateChecklistItemRequest, UpdateChecklistItemRequest, SaveChecklistRequest, SignoffRequest } from './assembly-interfaces';

class AssemblyChecklistHandler {
  // ── Catalog ──────────────────────────────────────────────────────────────────
  public listItems = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      ResponseBuilder.ok({ items: await assemblyChecklistService.listItems(ctx.schoolId) }, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public createItem = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const body = parseBody<CreateChecklistItemRequest>(event, callback); if (!body) return;
      ResponseBuilder.ok(await assemblyChecklistService.createItem(body, ctx.schoolId, ctx.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public updateItem = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const body = parseBody<UpdateChecklistItemRequest>(event, callback); if (!body) return;
      const result = await assemblyChecklistService.updateItem(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Checklist item not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public deleteItem = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const ok = await assemblyChecklistService.deleteItem(id, ctx.schoolId, ctx.userId);
      if (!ok) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Checklist item not found', callback); return; }
      ResponseBuilder.ok({ message: 'Checklist item deleted' }, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // ── Per-week ticking + sign-off ──────────────────────────────────────────────
  public getWeekChecklist = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const weekId = requireParam(event, 'id', callback); if (!weekId) return;
      const result = await assemblyChecklistService.getWeekChecklist(weekId, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public saveTicks = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const weekId = requireParam(event, 'id', callback); if (!weekId) return;
      const body = parseBody<SaveChecklistRequest>(event, callback); if (!body) return;
      const result = await assemblyChecklistService.saveTicks(weekId, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public signoff = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const weekId = requireParam(event, 'id', callback); if (!weekId) return;
      const body = (event.body ? parseBody<SignoffRequest>(event, callback) : {}) as SignoffRequest | null;
      if (body === null) return;
      const result = await assemblyChecklistService.signoff(weekId, body.note, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public clearSignoff = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const weekId = requireParam(event, 'id', callback); if (!weekId) return;
      const result = await assemblyChecklistService.clearSignoff(weekId, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new AssemblyChecklistHandler();
export const listItems = handler.listItems;
export const createItem = handler.createItem;
export const updateItem = handler.updateItem;
export const deleteItem = handler.deleteItem;
export const getWeekChecklist = handler.getWeekChecklist;
export const saveTicks = handler.saveTicks;
export const signoff = handler.signoff;
export const clearSignoff = handler.clearSignoff;
