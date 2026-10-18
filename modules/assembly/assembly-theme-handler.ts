import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { guard } from "../auth/authz";
import { ASSEMBLY_ACTIONS } from "./assembly-actions";
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { assemblyThemeService } from './assembly-theme-service';
import { CreateThemeRequest, UpdateThemeRequest } from './assembly-interfaces';

const NOT_FOUND = 'Theme not found';

class AssemblyThemeHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateThemeRequest>(event, callback);
      if (!body) return;
      const result = await assemblyThemeService.create(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      if (!q.academicYearId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId is required', callback); return; }
      const results = await assemblyThemeService.list(ctx.schoolId, q.academicYearId, q.planId);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const result = await assemblyThemeService.getById(id, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, NOT_FOUND, callback); return; }
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
      const body = parseBody<UpdateThemeRequest>(event, callback);
      if (!body) return;
      const result = await assemblyThemeService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, NOT_FOUND, callback); return; }
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
      const deleted = await assemblyThemeService.delete(id, ctx.schoolId, ctx.userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, NOT_FOUND, callback); return; }
      ResponseBuilder.ok({ message: 'Theme deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new AssemblyThemeHandler();
const g = (ref: string, fn: any) => guard(ASSEMBLY_ACTIONS[ref], fn);
export const create = g("assembly-theme-handler.create", handler.create);
export const list = g("assembly-theme-handler.list", handler.list);
export const getById = g("assembly-theme-handler.getById", handler.getById);
export const update = g("assembly-theme-handler.update", handler.update);
export const remove = g("assembly-theme-handler.remove", handler.remove);
