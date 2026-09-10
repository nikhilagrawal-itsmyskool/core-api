import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, requireManager, resolveEmployee, parseBody, requireParam, clientMeta } from "./document-util";
import { documentService } from "./document-service";
import { notifyDoc } from "./document-notify";

// Staff document handbook. Manager (god/admin) endpoints create/manage documents and see
// the who-signed report; the /me endpoints let a logged-in staff member read & sign.
class DocumentHandler {
  // GET /documents?includeArchived=1
  public list = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const includeArchived = (event.queryStringParameters || {}).includeArchived === "1";
      ResponseBuilder.ok(await documentService.listDocuments(auth.schoolId, includeArchived), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /documents/{id}
  public get = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const doc = await documentService.getDocument(auth.schoolId, id);
      if (!doc) return ResponseBuilder.notFound(ErrorCode.GeneralError, "Document not found", callback);
      ResponseBuilder.ok(doc, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /documents
  public create = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireManager(event, callback);
      if (!auth) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      const doc = await documentService.createDocument(auth.schoolId, body, auth.userId);
      if (doc.status === "published" && doc.requiresAck) {
        const ids = await documentService.notifyRecipients(auth.schoolId, doc.uuid, false);
        await notifyDoc(auth.schoolCode, ids, "policy_to_sign", "New policy to sign",
          `Please read and sign: ${doc.title}.`, doc.uuid);
      }
      ResponseBuilder.ok(doc, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // PUT /documents/{id}
  public update = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireManager(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      const doc = await documentService.updateDocument(auth.schoolId, id, body, auth.userId);
      // A new published version resets everyone to pending — nudge them.
      if (body.bumpVersion && doc.status === "published" && doc.requiresAck) {
        const ids = await documentService.notifyRecipients(auth.schoolId, doc.uuid, false);
        await notifyDoc(auth.schoolCode, ids, "policy_to_sign", "Updated policy to sign",
          `${doc.title} was updated (v${doc.version}) and needs your signature again.`, doc.uuid);
      }
      ResponseBuilder.ok(doc, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /documents/{id}/remind  — nudge only staff who haven't signed the current version
  public remind = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireManager(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const doc = await documentService.getDocument(auth.schoolId, id);
      if (!doc) return ResponseBuilder.notFound(ErrorCode.GeneralError, "Document not found", callback);
      const ids = await documentService.notifyRecipients(auth.schoolId, id, true);
      await notifyDoc(auth.schoolCode, ids, "policy_to_sign", "Reminder: policy to sign",
        `Please read and sign: ${doc.title}.`, id);
      ResponseBuilder.ok({ notified: ids.length }, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /documents/{id}/archive
  public archive = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireManager(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      await documentService.archiveDocument(auth.schoolId, id, auth.userId);
      ResponseBuilder.ok({ ok: true }, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /documents/{id}/acks
  public acks = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireManager(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      ResponseBuilder.ok(await documentService.listAcks(auth.schoolId, id), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /documents/acks/{ackId}/artifact?which=signature|page
  public ackArtifact = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireManager(event, callback);
      if (!auth) return;
      const ackId = requireParam(event, "ackId", callback);
      if (!ackId) return;
      const which = (event.queryStringParameters || {}).which === "page" ? "page" : "signature";
      const art = await documentService.getAckArtifact(auth.schoolId, ackId, which);
      if (!art) return ResponseBuilder.notFound(ErrorCode.GeneralError, "No such artifact", callback);
      ResponseBuilder.ok(art, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /documents/{id}/pdf
  public docPdf = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const pdf = await documentService.getDocPdf(auth.schoolId, id);
      if (!pdf) return ResponseBuilder.notFound(ErrorCode.GeneralError, "No PDF for this document", callback);
      ResponseBuilder.ok(pdf, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // ── Employee /me ────────────────────────────────────────────────────────────
  // GET /me/documents
  public myList = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      ResponseBuilder.ok(await documentService.myDocuments(emp.schoolId, emp.employeeId, emp.roles), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /me/documents/{id}
  public myGet = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      ResponseBuilder.ok(await documentService.getMyDocument(emp.schoolId, emp.employeeId, id, emp.roles), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /me/documents/{id}/acknowledge   (digital: declaredName + agreed + signatureBase64)
  public myAcknowledge = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      const res = await documentService.acknowledgeDigital(emp.schoolId, emp.employeeId, id, body, clientMeta(event), emp.employeeId);
      ResponseBuilder.ok(res, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /me/documents/{id}/upload-signed  (upload: fileName, mimeType, base64Data)
  public myUploadSigned = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      const res = await documentService.acknowledgeUpload(emp.schoolId, emp.employeeId, id, body, clientMeta(event), emp.employeeId);
      ResponseBuilder.ok(res, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /me/documents/{id}/pdf
  public myDocPdf = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const pdf = await documentService.myDocPdf(emp.schoolId, emp.employeeId, id);
      if (!pdf) return ResponseBuilder.notFound(ErrorCode.GeneralError, "No PDF for this document", callback);
      ResponseBuilder.ok(pdf, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /me/documents/{id}/artifact?which=signature|page
  public myArtifact = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const which = (event.queryStringParameters || {}).which === "page" ? "page" : "signature";
      const art = await documentService.myAckArtifact(emp.schoolId, emp.employeeId, id, which);
      if (!art) return ResponseBuilder.notFound(ErrorCode.GeneralError, "No signature on file", callback);
      ResponseBuilder.ok(art, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const h = new DocumentHandler();
export const list = h.list;
export const get = h.get;
export const create = h.create;
export const update = h.update;
export const remind = h.remind;
export const archive = h.archive;
export const acks = h.acks;
export const ackArtifact = h.ackArtifact;
export const docPdf = h.docPdf;
export const myList = h.myList;
export const myGet = h.myGet;
export const myAcknowledge = h.myAcknowledge;
export const myUploadSigned = h.myUploadSigned;
export const myDocPdf = h.myDocPdf;
export const myArtifact = h.myArtifact;
