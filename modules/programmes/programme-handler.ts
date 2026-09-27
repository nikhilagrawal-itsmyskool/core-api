import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, requireParam } from "./handler-util";
import { requireAction } from "../auth/authz";
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
      if (!requireAction(event, "programme.view", callback)) return;
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
      if (!requireAction(event, "programme.view", callback)) return;
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
}

const handler = new ProgrammeHandler();
export const list = handler.list;
export const getByCode = handler.getByCode;
