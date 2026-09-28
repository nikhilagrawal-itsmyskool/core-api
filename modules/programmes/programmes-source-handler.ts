import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { requireAction } from "../auth/authz";
import { programmeSourceService } from "./programmes-source-service";

class ProgrammesSourceHandler {
  // GET /sources?programme=&academicYearId= — the stored class-module docs per grade.
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
      const q = event.queryStringParameters || {};
      if (!q.programme) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "programme is required", callback);
        return;
      }
      const rows = await programmeSourceService.list(ctx.schoolId, q.programme, q.academicYearId);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /sources/{grade}/file?programme=&academicYearId= — download the .docx.
  public download = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, "programme.view", callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const grade = requireParam(event, "grade", callback);
      if (!grade) return;
      const q = event.queryStringParameters || {};
      if (!q.programme) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "programme is required", callback);
        return;
      }
      const file = await programmeSourceService.download(
        ctx.schoolId,
        q.programme,
        grade,
        q.academicYearId,
      );
      if (!file) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "No source document for this grade", callback);
        return;
      }
      ResponseBuilder.ok(file, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /sources/{grade}?programme= — re-upload a class-module .docx. OVERWRITES
  // that grade's monthly content (the client confirms first). Body: { base64Data, fileName, academicYearId }.
  public upload = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, "godpwa.programme.manage", callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const grade = requireParam(event, "grade", callback);
      if (!grade) return;
      const q = event.queryStringParameters || {};
      if (!q.programme) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "programme is required", callback);
        return;
      }
      const body = parseBody<{ base64Data: string; fileName?: string; academicYearId?: string }>(
        event,
        callback,
      );
      if (!body) return;
      const result = await programmeSourceService.upload(
        ctx.schoolId,
        q.programme,
        grade,
        body,
        ctx.userId,
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ProgrammesSourceHandler();
export const list = handler.list;
export const download = handler.download;
export const upload = handler.upload;
