import { ApiCallback, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { validateSchoolCodeHeader, getAuthorizationHeader } from "../auth/auth-utils";
import { extractAndVerifyToken } from "../auth/token-utils";
import { employeeService } from "./employee-service";
import { MANAGER_ROLES } from "./document-constants";

export interface RequestContext {
  schoolId: string;
  schoolCode: string;
  userId: string;
}

// Resolve the school from the X-School-Code header. Writes the error + returns null on
// failure so callers can bail cleanly (mirrors the leave module's handler-util).
export async function resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<RequestContext | null> {
  const schoolCode = validateSchoolCodeHeader(event);
  const schoolId = await employeeService.getSchoolIdByCode(schoolCode);
  if (!schoolId) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Invalid school code", callback);
    return null;
  }
  const userId = event.requestContext?.authorizer?.principalId || "system";
  return { schoolId, schoolCode, userId };
}

// Resolve the school AND require a manager (god/admin) employee token — gates document
// create/manage + the who-signed report.
export async function requireManager(event: ApiEvent, callback: ApiCallback): Promise<RequestContext | null> {
  const ctx = await resolveSchool(event, callback);
  if (!ctx) return null;
  const token = extractAndVerifyToken(getAuthorizationHeader(event));
  const roles = token && Array.isArray(token.roles) ? token.roles : [];
  const ok = !!token && token.type === "employee" && roles.some((r) => (MANAGER_ROLES as readonly string[]).includes(r));
  if (!ok) {
    ResponseBuilder.forbidden(ErrorCode.MissingPermission, "Only an admin/god user can manage documents", callback);
    return null;
  }
  return ctx;
}

// Resolve the logged-in employee from the bearer token (staff /me surface), including the
// caller's role names (lowercased) — used to exempt certain roles from signing.
export function resolveEmployee(event: ApiEvent, callback: ApiCallback): { employeeId: string; schoolId: string; roles: string[] } | null {
  const token = extractAndVerifyToken(getAuthorizationHeader(event));
  const employeeId = token?.employee_id || token?.id;
  if (!token || token.type !== "employee" || !employeeId) {
    ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, "Employee login required", callback);
    return null;
  }
  const roles = Array.isArray(token.roles) ? token.roles.map((r: string) => String(r).toLowerCase()) : [];
  return { employeeId, schoolId: token.school_id, roles };
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

// Client IP + user-agent for the acknowledgement record (best-effort).
export function clientMeta(event: ApiEvent): { ip: string | null; userAgent: string | null } {
  const h = event.headers || {};
  const ip = event.requestContext?.identity?.sourceIp || h["X-Forwarded-For"] || h["x-forwarded-for"] || null;
  const ua = h["User-Agent"] || h["user-agent"] || null;
  return {
    ip: ip ? String(ip).split(",")[0].trim().slice(0, 64) : null,
    userAgent: ua ? String(ua).slice(0, 256) : null,
  };
}
