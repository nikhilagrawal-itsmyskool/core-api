import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { guard } from "../auth/authz";
import { ASSEMBLY_ACTIONS } from "./assembly-actions";
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
      // Admin sign-off is unrestricted (no submit-lock).
      const result = await assemblyChecklistService.signoff(weekId, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // Reopen a sign-off — admin/god only. ?date=yyyy-mm-dd clears that day; omitted = weekly.
  public clearSignoff = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const weekId = requireParam(event, 'id', callback); if (!weekId) return;
      const date = event.queryStringParameters?.date || null;
      const result = await assemblyChecklistService.clearSignoff(weekId, ctx.schoolId, date);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new AssemblyChecklistHandler();
const g = (ref: string, fn: any) => guard(ASSEMBLY_ACTIONS[ref], fn);
export const listItems = g("assembly-checklist-handler.listItems", handler.listItems);
export const createItem = g("assembly-checklist-handler.createItem", handler.createItem);
export const updateItem = g("assembly-checklist-handler.updateItem", handler.updateItem);
export const deleteItem = g("assembly-checklist-handler.deleteItem", handler.deleteItem);
export const getWeekChecklist = g("assembly-checklist-handler.getWeekChecklist", handler.getWeekChecklist);
export const saveTicks = g("assembly-checklist-handler.saveTicks", handler.saveTicks);
export const signoff = g("assembly-checklist-handler.signoff", handler.signoff);
export const clearSignoff = g("assembly-checklist-handler.clearSignoff", handler.clearSignoff);
