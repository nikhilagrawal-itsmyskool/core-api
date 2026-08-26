import { ApiCallback, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { validateSchoolCodeHeader, getAuthorizationHeader } from "../auth/auth-utils";
import { extractAndVerifyToken } from "../auth/token-utils";
import { getCaller } from "../auth/authz";
import { getSchoolIdByCode } from "./examination-common";

export interface RequestContext {
  schoolId: string;
  schoolCode: string;
  userId: string;
}

// Resolve the school from the X-School-Code header. On failure, writes the
// appropriate error response and returns null so the caller can bail out. (RBAC is
// handled separately by the `guard(action, fn)` wrapper at the export site.)
export async function resolveSchool(
  event: ApiEvent,
  callback: ApiCallback,
): Promise<RequestContext | null> {
  const schoolCode = validateSchoolCodeHeader(event);
  const schoolId = await getSchoolIdByCode(schoolCode);
  if (!schoolId) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Invalid school code", callback);
    return null;
  }
  const userId = event.requestContext?.authorizer?.principalId || "system";
  return { schoolId, schoolCode, userId };
}

export function parseBody<T>(event: ApiEvent, callback: ApiCallback): T | null {
  if (!event.body) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Request body is required", callback);
    return null;
  }
  return JSON.parse(event.body) as T;
}

export function requireParam(
  event: ApiEvent,
  name: string,
  callback: ApiCallback,
): string | null {
  const value = event.pathParameters?.[name];
  if (!value) {
    ResponseBuilder.badRequest(ErrorCode.MissingId, `${name} is required`, callback);
    return null;
  }
  return value;
}

// Resolve the logged-in employee (invigilator) from the bearer token — for the
// teacher-PWA invigilation surface. Verifies the token in-handler; writes 401 on failure.
export function resolveEmployee(
  event: ApiEvent,
  callback: ApiCallback,
): { employeeId: string; schoolId: string } | null {
  const token = extractAndVerifyToken(getAuthorizationHeader(event));
  const employeeId = token?.employee_id || token?.id;
  if (!token || token.type !== "employee" || !employeeId) {
    ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, "Employee login required", callback);
    return null;
  }
  return { employeeId, schoolId: token.school_id };
}

// Roles off the verified caller (JWT, or the offline override which defaults to god).
// Used for the god-only dues-threshold branch. Falls back to [] so a missing token
// simply lacks the role.
export function callerHasRole(event: ApiEvent, role: string): boolean {
  const caller = getCaller(event);
  return !!caller && Array.isArray(caller.roles) && caller.roles.includes(role);
}
