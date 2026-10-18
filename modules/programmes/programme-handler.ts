import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { guard } from "../auth/authz";
import { PROGRAMME_ACTIONS } from "./programmes-actions";
import { programmeService } from "./programme-service";

class ProgrammeHandler {
  // GET /catalog — the programme rows for this school.
  public list = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      ResponseBuilder.ok(await programmeService.list(ctx.schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /catalog/{code} — a programme plus its seeded masters (editor dropdowns).
  public getByCode = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const code = requireParam(event, "code", callback);
      if (!code) return;
      const result = await programmeService.getByCode(ctx.schoolId, code);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Programme not found", callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /catalog/{code} — update programme settings (motto, philosophy, guidance). God-only.
  public update = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const code = requireParam(event, "code", callback);
      if (!code) return;
      const body = parseBody<{ motto?: string; philosophy?: string; teacherGuidance?: string[] }>(
        event,
        callback,
      );
      if (!body) return;
      const result = await programmeService.update(ctx.schoolId, code, body, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Programme not found", callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ProgrammeHandler();
const g = (ref: string, fn: any) => guard(PROGRAMME_ACTIONS[ref], fn);
export const list = g("programme-handler.list", handler.list);
export const getByCode = g("programme-handler.getByCode", handler.getByCode);
export const update = g("programme-handler.update", handler.update);
