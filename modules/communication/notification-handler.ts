import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  validateSchoolCodeHeader,
  getAuthorizationHeader,
  guardActiveStudent,
} from "../auth/auth-utils";
import { extractAndVerifyToken } from "../auth/token-utils";
import { notificationService, NotifyRecipientType } from "./notification-service";

interface CreateNotificationBody {
  recipientType: NotifyRecipientType;
  recipientIds: string[];
  key?: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}

function parseBody<T>(event: ApiEvent, callback: ApiCallback): T | null {
  if (!event.body) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Request body is required", callback);
    return null;
  }
  return JSON.parse(event.body) as T;
}

// Resolve the /me caller as a notification recipient. An employee token maps to the
// employee inbox; otherwise fall back to the family/student guard (active child).
// Returns null AND writes the error response on failure.
function resolveRecipient(
  event: ApiEvent,
  callback: ApiCallback,
): { schoolId: string; recipientType: NotifyRecipientType; recipientId: string } | null {
  const token = extractAndVerifyToken(getAuthorizationHeader(event));
  if (token && token.type === "employee") {
    const employeeId = token.employee_id || token.id;
    if (!employeeId) {
      ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, "Employee login required", callback);
      return null;
    }
    return { schoolId: token.school_id, recipientType: "employee", recipientId: employeeId };
  }
  const auth = guardActiveStudent(event, callback);
  if (!auth) return null; // guard already wrote the response
  return { schoolId: auth.token.school_id, recipientType: "student", recipientId: auth.activeStudentId };
}

class NotificationHandler {
  // POST /communication/notifications  (machine-to-machine; called by other modules)
  public create = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await notificationService.getSchoolIdByCode(schoolCode);
      if (!schoolId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Invalid school code", callback);
      const body = parseBody<CreateNotificationBody>(event, callback);
      if (!body) return;
      if (body.recipientType !== "employee" && body.recipientType !== "student") {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "recipientType must be employee or student", callback);
      }
      if (!Array.isArray(body.recipientIds) || !body.recipientIds.length) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "recipientIds is required", callback);
      }
      if (!body.title) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "title is required", callback);
      const userId = event.requestContext?.authorizer?.principalId || "system";
      const result = await notificationService.create({
        schoolId,
        recipientType: body.recipientType,
        recipientIds: body.recipientIds,
        key: body.key,
        title: body.title,
        body: body.body,
        entityType: body.entityType,
        entityId: body.entityId,
        userId,
      });
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /communication/me/notifications?unreadOnly=&limit=
  public list = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const r = resolveRecipient(event, callback);
      if (!r) return;
      const q = event.queryStringParameters || {};
      const result = await notificationService.list(r.schoolId, r.recipientType, r.recipientId, {
        unreadOnly: q.unreadOnly === "true",
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
      });
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /communication/me/notifications/{id}/read
  public markRead = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const r = resolveRecipient(event, callback);
      if (!r) return;
      const id = event.pathParameters?.id;
      if (!id) return ResponseBuilder.badRequest(ErrorCode.MissingId, "id is required", callback);
      await notificationService.markRead(r.schoolId, r.recipientType, r.recipientId, id);
      const result = await notificationService.list(r.schoolId, r.recipientType, r.recipientId, {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /communication/me/notifications/read-all
  public markAllRead = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const r = resolveRecipient(event, callback);
      if (!r) return;
      await notificationService.markAllRead(r.schoolId, r.recipientType, r.recipientId);
      ResponseBuilder.ok({ ok: true }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /communication/me/devices  { platform, token }
  public registerDevice = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const r = resolveRecipient(event, callback);
      if (!r) return;
      const body = parseBody<{ platform: string; token: string }>(event, callback);
      if (!body) return;
      if (!body.token) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "token is required", callback);
      await notificationService.registerDevice(r.schoolId, r.recipientType, r.recipientId, body.platform || "web", body.token);
      ResponseBuilder.ok({ ok: true }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /communication/me/devices  { token }
  public unregisterDevice = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const r = resolveRecipient(event, callback);
      if (!r) return;
      const body = parseBody<{ token: string }>(event, callback);
      if (!body) return;
      if (!body.token) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "token is required", callback);
      await notificationService.unregisterDevice(r.schoolId, body.token);
      ResponseBuilder.ok({ ok: true }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new NotificationHandler();
export const create = h.create;
export const list = h.list;
export const markRead = h.markRead;
export const markAllRead = h.markAllRead;
export const registerDevice = h.registerDevice;
export const unregisterDevice = h.unregisterDevice;
