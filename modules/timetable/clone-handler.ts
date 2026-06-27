import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody } from "./handler-util";
import { timetableService } from "./timetable-service";
import { cloneService } from "./clone-service";
import { CloneClassSetupRequest } from "./timetable-interfaces";

class CloneHandler {
  // POST /timetable/clone-class-setup
  // Body: { sourceClassId, targetClassId, academicYearId }
  public cloneClassSetup = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CloneClassSetupRequest>(event, callback);
      if (!body) return;

      if (!body.sourceClassId || !body.targetClassId || !body.academicYearId) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "sourceClassId, targetClassId and academicYearId are required",
          callback,
        );
        return;
      }

      const [sourceOk, targetOk] = await Promise.all([
        timetableService.classExists(body.sourceClassId, ctx.schoolId),
        timetableService.classExists(body.targetClassId, ctx.schoolId),
      ]);
      if (!sourceOk) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "Invalid sourceClassId",
          callback,
        );
        return;
      }
      if (!targetOk) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "Invalid targetClassId",
          callback,
        );
        return;
      }

      const result = await cloneService.cloneClassSetup(
        body,
        ctx.schoolId,
        ctx.userId,
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new CloneHandler();
export const cloneClassSetup = handler.cloneClassSetup;
