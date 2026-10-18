import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { guard } from "../auth/authz";
import { ASSEMBLY_ACTIONS } from "./assembly-actions";
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool } from './handler-util';
import { assemblyResolveService } from './assembly-resolve-service';

class AssemblyResolveHandler {
  // GET /resolve?planId=&date= — the resolved assembly for a plan on a date.
  public resolve = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      if (!q.planId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'planId is required', callback); return; }
      if (!q.date) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'date is required', callback); return; }
      // Staff surface: include day-level references (staff-only; the student /me path omits them).
      const result = await assemblyResolveService.resolve(q.planId, q.date, ctx.schoolId, { includeReferences: true });
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Plan not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new AssemblyResolveHandler();
const g = (ref: string, fn: any) => guard(ASSEMBLY_ACTIONS[ref], fn);
export const resolve = g("assembly-resolve-handler.resolve", handler.resolve);
