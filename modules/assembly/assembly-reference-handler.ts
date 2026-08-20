import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { assemblyReferenceService } from './assembly-reference-service';
import { AddReferenceRequest, UpdateReferenceRequest } from './assembly-interfaces';

// Day-level assembly references (description + one image, up to 5 per day). Admin
// surface (X-School-Code + JWT). Editable while the roster week is a draft.
class AssemblyReferenceHandler {
  // GET /assembly/weeks/{id}/references
  public list = async (event: ApiEvent, ctx: ApiContext, cb: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, cb); if (!auth) return;
      const weekId = requireParam(event, 'id', cb); if (!weekId) return;
      ResponseBuilder.ok(await assemblyReferenceService.listForWeek(auth.schoolId, weekId), cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // POST /assembly/weeks/{id}/references { entryDate, description, fileName, mimeType, base64Data }
  public add = async (event: ApiEvent, ctx: ApiContext, cb: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, cb); if (!auth) return;
      const weekId = requireParam(event, 'id', cb); if (!weekId) return;
      const body = parseBody<AddReferenceRequest>(event, cb); if (!body) return;
      const result = await assemblyReferenceService.add(auth.schoolId, auth.userId, weekId, body);
      if (result === null) return ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', cb);
      ResponseBuilder.ok(result, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // PUT /assembly/weeks/{id}/references/{refId} { description }
  public update = async (event: ApiEvent, ctx: ApiContext, cb: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, cb); if (!auth) return;
      const weekId = requireParam(event, 'id', cb); if (!weekId) return;
      const refId = requireParam(event, 'refId', cb); if (!refId) return;
      const body = parseBody<UpdateReferenceRequest>(event, cb); if (!body) return;
      const result = await assemblyReferenceService.update(auth.schoolId, auth.userId, weekId, refId, body);
      if (result === null) return ResponseBuilder.notFound(ErrorCode.InvalidId, 'Reference not found', cb);
      ResponseBuilder.ok(result, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // DELETE /assembly/weeks/{id}/references/{refId}
  public remove = async (event: ApiEvent, ctx: ApiContext, cb: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, cb); if (!auth) return;
      const weekId = requireParam(event, 'id', cb); if (!weekId) return;
      const refId = requireParam(event, 'refId', cb); if (!refId) return;
      const result = await assemblyReferenceService.remove(auth.schoolId, auth.userId, weekId, refId);
      if (result === null) return ResponseBuilder.notFound(ErrorCode.InvalidId, 'Reference not found', cb);
      ResponseBuilder.ok(result, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // GET /assembly/references/{id}/file — base64 image bytes (local-dev fallback)
  public getFile = async (event: ApiEvent, ctx: ApiContext, cb: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, cb); if (!auth) return;
      const id = requireParam(event, 'id', cb); if (!id) return;
      const r = await assemblyReferenceService.getFile(auth.schoolId, id);
      if (!r) return ResponseBuilder.notFound(ErrorCode.InvalidId, 'Reference not found', cb);
      ResponseBuilder.ok({ fileName: r.fileName, mimeType: r.mimeType, base64Data: r.base64 }, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };
}

const h = new AssemblyReferenceHandler();
export const list = h.list;
export const add = h.add;
export const update = h.update;
export const remove = h.remove;
export const getFile = h.getFile;
