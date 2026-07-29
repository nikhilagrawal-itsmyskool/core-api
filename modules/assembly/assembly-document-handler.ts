import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { assemblyDocumentService, UploadDocRequest } from './assembly-document-service';

// Reference documents (source Word/PDF the assembly was built from): upload/replace,
// list, download, delete. Admin surface (X-School-Code + JWT).
class AssemblyDocumentHandler {
  // GET /assembly/documents
  public list = async (event: ApiEvent, ctx: ApiContext, cb: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, cb);
      if (!auth) return;
      ResponseBuilder.ok(await assemblyDocumentService.list(auth.schoolId), cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // POST /assembly/documents { kind, fileName, mimeType, base64Data }
  public upload = async (event: ApiEvent, ctx: ApiContext, cb: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, cb);
      if (!auth) return;
      const body = parseBody<UploadDocRequest>(event, cb);
      if (!body) return;
      if (!body.kind) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'kind is required', cb);
      ResponseBuilder.ok(await assemblyDocumentService.upload(auth.schoolId, auth.userId, body), cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // GET /assembly/documents/{id}/file — base64 for download
  public getFile = async (event: ApiEvent, ctx: ApiContext, cb: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, cb);
      if (!auth) return;
      const id = requireParam(event, 'id', cb);
      if (!id) return;
      const r = await assemblyDocumentService.getFile(auth.schoolId, id);
      if (!r) return ResponseBuilder.notFound(ErrorCode.InvalidId, 'Document not found', cb);
      ResponseBuilder.ok({ fileName: r.fileName, mimeType: r.mimeType, base64Data: r.base64 }, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // DELETE /assembly/documents/{id}
  public remove = async (event: ApiEvent, ctx: ApiContext, cb: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, cb);
      if (!auth) return;
      const id = requireParam(event, 'id', cb);
      if (!id) return;
      const r = await assemblyDocumentService.remove(auth.schoolId, auth.userId, id);
      if (!r) return ResponseBuilder.notFound(ErrorCode.InvalidId, 'Document not found', cb);
      ResponseBuilder.ok(r, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };
}

const h = new AssemblyDocumentHandler();
export const list = h.list;
export const upload = h.upload;
export const getFile = h.getFile;
export const remove = h.remove;
