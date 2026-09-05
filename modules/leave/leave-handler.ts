import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, requireApprover, parseBody, requireParam } from "./handler-util";
import { leaveService } from "./leave-service";
import { DecisionRequest } from "./leave-interfaces";

const MONTH_RE = /^\d{4}-\d{2}$/;

// Admin/office surface (X-School-Code + JWT). Approve/reject require an approver
// (god/admin) role; the rest are read/listing for the office.
class LeaveHandler {
  // GET /leave/config
  public getConfig = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      ResponseBuilder.ok(await leaveService.ensureConfig(auth.schoolId, auth.userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/types
  public listTypes = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      ResponseBuilder.ok(await leaveService.listTypes(auth.schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/applications?status=&employeeId=&from=&to=
  public listApplications = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const rows = await leaveService.listApplications(auth.schoolId, {
        status: q.status || undefined,
        employeeId: q.employeeId || undefined,
        from: q.from || undefined,
        to: q.to || undefined,
      });
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/applications/{id}
  public getApplication = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const app = await leaveService.getApplication(auth.schoolId, id);
      if (!app) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Leave application not found", callback);
      ResponseBuilder.ok(app, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /leave/applications/{id}/approve   (approver only)
  public approve = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireApprover(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const app = await leaveService.approve(auth.schoolId, id, auth.userId);
      if (!app) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Leave application not found", callback);
      ResponseBuilder.ok(app, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /leave/applications/{id}/reject   (approver only)  { note? }
  public reject = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await requireApprover(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<DecisionRequest>(event, callback);
      if (!body) return;
      const app = await leaveService.reject(auth.schoolId, id, body.note, auth.userId);
      if (!app) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Leave application not found", callback);
      ResponseBuilder.ok(app, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/applications/{id}/attachment
  public getAttachment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const doc = await leaveService.getAttachment(auth.schoolId, id);
      if (!doc) return ResponseBuilder.notFound(ErrorCode.InvalidId, "No document on this application", callback);
      ResponseBuilder.ok({ mimeType: doc.mimeType, fileName: doc.fileName, dataUri: `data:${doc.mimeType};base64,${doc.data}` }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/applications/{id}/audit
  public getAudit = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      ResponseBuilder.ok(await leaveService.getAudit(auth.schoolId, id), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /leave/balance?employeeId=&month=YYYY-MM
  public balance = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      if (!q.employeeId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "employeeId is required", callback);
      const month = q.month && MONTH_RE.test(q.month) ? q.month : new Date().toISOString().slice(0, 7);
      ResponseBuilder.ok(await leaveService.balance(auth.schoolId, q.employeeId, month), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new LeaveHandler();
export const getConfig = h.getConfig;
export const listTypes = h.listTypes;
export const listApplications = h.listApplications;
export const getApplication = h.getApplication;
export const approve = h.approve;
export const reject = h.reject;
export const getAttachment = h.getAttachment;
export const getAudit = h.getAudit;
export const balance = h.balance;
