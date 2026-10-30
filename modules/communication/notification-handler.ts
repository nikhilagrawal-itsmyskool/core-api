import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  validateSchoolCodeHeader,
  getAuthorizationHeader,
  guardActiveStudent,
} from "../auth/auth-utils";
import { extractAndVerifyToken } from "../auth/token-utils";
import { guard } from "../auth/authz";
import { COMMUNICATION_ACTIONS } from "./communication-actions";
import { notificationService, NotifyRecipientType } from "./notification-service";

interface CreateNotificationBody {
  recipientType: NotifyRecipientType;
  recipientIds: string[];
  all?: boolean;
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

interface MeScope {
  schoolId: string;
  // Inbox scope: employee → [employeeId]; parent → all sibling student uuids.
  recipientType: "employee" | "student";
  recipientIds: string[];
  // Device scope: employee → ('employee', employeeId); parent → ('family', familyNumber)
  // so the one shared phone receives every child's notifications.
  deviceType: "employee" | "family";
  deviceId: string;
}

// Resolve the /me caller. An employee token maps to the employee inbox/device; a family
// token resolves the active child to the WHOLE family — the inbox lists every sibling's
// notifications and the device is registered family-wide. Returns null AND writes the
// error response on failure. Async (parent resolution needs a DB lookup).
async function resolveMe(event: ApiEvent, callback: ApiCallback): Promise<MeScope | null> {
  const token = extractAndVerifyToken(getAuthorizationHeader(event));
  if (token && token.type === "employee") {
    const employeeId = token.employee_id || token.id;
    if (!employeeId) {
      ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, "Employee login required", callback);
      return null;
    }
    return { schoolId: token.school_id, recipientType: "employee", recipientIds: [employeeId], deviceType: "employee", deviceId: employeeId };
  }
  const auth = guardActiveStudent(event, callback);
  if (!auth) return null; // guard already wrote the response
  const { familyNumber, studentIds } = await notificationService.resolveFamily(auth.token.school_id, auth.activeStudentId);
  return {
    schoolId: auth.token.school_id,
    recipientType: "student",
    recipientIds: studentIds,
    deviceType: "family",
    deviceId: familyNumber || auth.activeStudentId,
  };
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
      if (!body.all && (!Array.isArray(body.recipientIds) || !body.recipientIds.length)) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "recipientIds is required (or set all:true)", callback);
      }
      if (!body.title) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "title is required", callback);
      const userId = event.requestContext?.authorizer?.principalId || "system";
      const result = await notificationService.create({
        schoolId,
        recipientType: body.recipientType,
        recipientIds: body.recipientIds || [],
        all: body.all,
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
      const r = await resolveMe(event, callback);
      if (!r) return;
      // Push-independent "last active" telemetry: a family opening the app lands here
      // (Home bell fetch). Throttled + swallowed so it never delays or breaks the read.
      if (r.deviceType === "family") {
        try { await notificationService.touchFamilyActive(r.schoolId, r.deviceId); } catch { /* telemetry only */ }
      }
      const q = event.queryStringParameters || {};
      const result = await notificationService.list(r.schoolId, r.recipientType, r.recipientIds, {
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
      const r = await resolveMe(event, callback);
      if (!r) return;
      const id = event.pathParameters?.id;
      if (!id) return ResponseBuilder.badRequest(ErrorCode.MissingId, "id is required", callback);
      await notificationService.markRead(r.schoolId, r.recipientType, r.recipientIds, id);
      const result = await notificationService.list(r.schoolId, r.recipientType, r.recipientIds, {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /communication/me/notifications/read-all
  public markAllRead = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const r = await resolveMe(event, callback);
      if (!r) return;
      await notificationService.markAllRead(r.schoolId, r.recipientType, r.recipientIds);
      ResponseBuilder.ok({ ok: true }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /communication/me/devices  { platform, token }
  public registerDevice = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const r = await resolveMe(event, callback);
      if (!r) return;
      const body = parseBody<{ platform: string; token: string }>(event, callback);
      if (!body) return;
      if (!body.token) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "token is required", callback);
      await notificationService.registerDevice(r.schoolId, r.deviceType, r.deviceId, body.platform || "web", body.token);
      ResponseBuilder.ok({ ok: true }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /communication/me/devices  { token }
  public unregisterDevice = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const r = await resolveMe(event, callback);
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
// POST /notifications — cross-module fan-out. guard() → service tokens bypass, humans need
// communication.message.send. The /me endpoints below self-authorize (own inbox) and stay ungated.
export const create = guard(COMMUNICATION_ACTIONS['notification-handler.create'], h.create);
export const list = h.list;
export const markRead = h.markRead;
export const markAllRead = h.markAllRead;
export const registerDevice = h.registerDevice;
export const unregisterDevice = h.unregisterDevice;
