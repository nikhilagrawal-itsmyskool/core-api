import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { getCallerContext } from "../auth/auth-utils";
import {
  syllabusReconcileService,
  ReconcileDecision,
} from "./syllabus-reconcile-service";

interface PreviewBody {
  fileName?: string;
  base64Data: string;
}
interface ApplyBody {
  fileName?: string;
  base64Data: string;
  decisions?: ReconcileDecision[];
  note?: string;
}

// Reconcile is a powerful, plan-wide rewrite — restrict to admin/god while it's
// young (Phase A). Returns true if the caller is allowed; otherwise writes 403.
function requireAdminGod(event: ApiEvent, callback: ApiCallback): boolean {
  if (getCallerContext(event).isAdminGod) return true;
  ResponseBuilder.forbidden(
    ErrorCode.GeneralError,
    "Syllabus reconcile is restricted to admin users",
    callback,
  );
  return false;
}

class SyllabusReconcileHandler {
  // POST /syllabi/{id}/reconcile/preview — parse + match, no writes.
  public preview = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAdminGod(event, callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<PreviewBody>(event, callback);
      if (!body) return;
      if (!body.base64Data) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "file data is required", callback);
        return;
      }
      const result = await syllabusReconcileService.preview(id, body.base64Data, body.fileName, ctx.schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Syllabus not found", callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /syllabi/{id}/reconcile/apply — apply the diff + human decisions in a txn.
  public apply = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAdminGod(event, callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<ApplyBody>(event, callback);
      if (!body) return;
      if (!body.base64Data) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "file data is required", callback);
        return;
      }
      const result = await syllabusReconcileService.apply(
        id, body.base64Data, body.fileName, body.decisions || [], body.note, ctx.schoolId, ctx.userId,
      );
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Syllabus not found", callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /syllabi/{id}/revisions — the last-10 strip.
  public listRevisions = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAdminGod(event, callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      ResponseBuilder.ok(await syllabusReconcileService.listRevisions(id, ctx.schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /revisions/{id}/source — download the .docx a revision was built from.
  public downloadRevision = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAdminGod(event, callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const file = await syllabusReconcileService.getRevisionSource(id, ctx.schoolId);
      if (!file) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "No source document for this revision", callback);
        return;
      }
      ResponseBuilder.ok({ fileName: file.fileName, mimeType: file.mimeType, base64Data: file.base64 }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SyllabusReconcileHandler();
export const preview = handler.preview;
export const apply = handler.apply;
export const listRevisions = handler.listRevisions;
export const downloadRevision = handler.downloadRevision;
