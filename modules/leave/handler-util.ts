import { ApiCallback, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { validateSchoolCodeHeader, getAuthorizationHeader } from "../auth/auth-utils";
import { extractAndVerifyToken } from "../auth/token-utils";
import { getSchoolIdByCode } from "./leave-common";
import { APPROVER_ROLES } from "./leave-constants";

export interface RequestContext {
  schoolId: string;
  schoolCode: string;
  userId: string;
}

// Resolve the school from the X-School-Code header. On failure writes the error
// response and returns null so the caller can bail.
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

// Resolve the school AND require an approver (god/admin) employee token. Used to
// gate approve/reject. There is no Director/Principal role yet — see DESIGN.md §5.
export async function requireApprover(
  event: ApiEvent,
  callback: ApiCallback,
): Promise<RequestContext | null> {
  const ctx = await resolveSchool(event, callback);
  if (!ctx) return null;
  const token = extractAndVerifyToken(getAuthorizationHeader(event));
  const roles = token && Array.isArray(token.roles) ? token.roles : [];
  const isApprover = !!token && token.type === "employee" && roles.some((r) => (APPROVER_ROLES as readonly string[]).includes(r));
  if (!isApprover) {
    ResponseBuilder.forbidden(ErrorCode.MissingPermission, "Only an admin/god user can decide leave", callback);
    return null;
  }
  return ctx;
}

// Resolve the logged-in employee from the bearer token (teacher /me surface).
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
