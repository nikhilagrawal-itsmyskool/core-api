import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { syllabusProgressService } from "./syllabus-progress-service";
import {
  BulkProgressRequest,
  MarkProgressRequest,
} from "./syllabus-interfaces";

class SyllabusProgressHandler {
  // GET /syllabi/{id}/progress?classId= — entries + this section's coverage.
  public getRoster = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const classId = (event.queryStringParameters || {}).classId;
      if (!classId) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "classId query parameter is required",
          callback,
        );
        return;
      }
      const result = await syllabusProgressService.getRoster(
        id,
        classId,
        ctx.schoolId,
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Syllabus not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /progress — mark one entry covered/pending for a section.
  public mark = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<MarkProgressRequest>(event, callback);
      if (!body) return;
      const result = await syllabusProgressService.mark(
        body,
        ctx.schoolId,
        ctx.userId,
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /progress/bulk — mark many entries for one section.
  public markBulk = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<BulkProgressRequest>(event, callback);
      if (!body) return;
      const result = await syllabusProgressService.markBulk(
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

const handler = new SyllabusProgressHandler();
export const getRoster = handler.getRoster;
export const mark = handler.mark;
export const markBulk = handler.markBulk;
