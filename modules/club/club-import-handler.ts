import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { clubImportService } from "./club-import-service";
import { CLUB_ACTIONS } from "./club-actions";

// Strip an optional data: URI prefix from an uploaded base64 payload.
const rawBase64 = (s: string): string => (s || "").replace(/^data:[^;]+;base64,/, "");

class ClubImportHandler {
  // GET /club/clubs/{id}/activities/export  -> { fileName, dataUri, count }
  public exportBank = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const out = await clubImportService.exportBank(auth.schoolId, id);
      const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      ResponseBuilder.ok({ fileName: out.fileName, count: out.count, dataUri: `data:${mime};base64,${out.base64}` }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /club/clubs/{id}/activities/import/preview  { file: base64 }
  public preview = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<{ file: string }>(event, callback);
      if (!body) return;
      if (!body.file) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "file (base64) is required", callback);
      ResponseBuilder.ok(await clubImportService.preview(auth.schoolId, id, rawBase64(body.file)), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /club/clubs/{id}/activities/import  { file: base64, fileName? }
  public commit = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<{ file: string; fileName?: string }>(event, callback);
      if (!body) return;
      if (!body.file) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "file (base64) is required", callback);
      ResponseBuilder.ok(await clubImportService.commit(auth.schoolId, id, rawBase64(body.file), body.fileName || "import.xlsx", auth.userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /club/clubs/{id}/imports
  public listImports = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      ResponseBuilder.ok(await clubImportService.listImports(auth.schoolId, id), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new ClubImportHandler();
export const exportBank = guard(CLUB_ACTIONS["club-import-handler.exportBank"], h.exportBank);
export const preview = guard(CLUB_ACTIONS["club-import-handler.preview"], h.preview);
export const commit = guard(CLUB_ACTIONS["club-import-handler.commit"], h.commit);
export const listImports = guard(CLUB_ACTIONS["club-import-handler.listImports"], h.listImports);
