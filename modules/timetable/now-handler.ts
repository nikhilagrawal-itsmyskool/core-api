import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool } from "./handler-util";
import { nowService } from "./now-service";

class NowHandler {
  // GET /timetable/now?classId=&at=  — what a class is doing at the given moment
  // (school-local). `at` is an optional ISO instant (defaults to now); handy for
  // testing and for rendering "what's happening" at a chosen time.
  public now = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      if (!qp.classId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "classId is required", callback);
        return;
      }
      const result = await nowService.happeningNow(ctx.schoolId, qp.classId, qp.at);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new NowHandler();
export const now = handler.now;
