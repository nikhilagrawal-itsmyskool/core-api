import { ApiCallback, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  validateSchoolCodeHeader,
  getSchoolCodeFromHeader,
  getAuthorizationHeader,
} from "../auth/auth-utils";
import { getSchoolIdByCode } from "./assistant-common";

export interface RequestContext {
  schoolId: string;
  schoolCode: string;
  userId: string;
  // The caller's bearer token — forwarded to the data modules so their
  // authorization + contact masking reflect the real manager, not a service token.
  authorization?: string;
}

export async function resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<RequestContext | null> {
  const schoolCode = validateSchoolCodeHeader(event);
  const schoolId = await getSchoolIdByCode(schoolCode);
  if (!schoolId) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Invalid school code", callback);
    return null;
  }
  const userId = event.requestContext?.authorizer?.principalId || "system";
  return { schoolId, schoolCode, userId, authorization: getAuthorizationHeader(event) };
}

// The verify-token authorizer has already validated the signature by the time we run, so we
// just read the (trusted) claims from the JWT payload to gate on role — no re-verify / no
// jsonwebtoken dependency. The assistant carries a god token on the desk device and exposes the
// whole read surface, so we restrict its use to GOD callers only (not admin).
function claimsFromEvent(event: ApiEvent): any | null {
  const h = getAuthorizationHeader(event) || "";
  const token = h.replace(/^Bearer\s+/i, "").trim();
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function isGodCaller(event: ApiEvent): boolean {
  const c = claimsFromEvent(event);
  const roles: string[] = Array.isArray(c?.roles) ? c.roles : [];
  return c?.type === "employee" && roles.includes("god");
}

export function parseBody<T>(event: ApiEvent, callback: ApiCallback): T | null {
  if (!event.body) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Request body is required", callback);
    return null;
  }
  return JSON.parse(event.body) as T;
}

export function requireParam(event: ApiEvent, name: string, callback: ApiCallback): string | null {
  const value = event.pathParameters?.[name];
  if (!value) {
    ResponseBuilder.badRequest(ErrorCode.MissingId, `${name} is required`, callback);
    return null;
  }
  return value;
}

export { getSchoolCodeFromHeader, getAuthorizationHeader };
