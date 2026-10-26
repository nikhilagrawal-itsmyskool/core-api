import { ApiCallback, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader, getAuthorizationHeader } from '../auth/auth-utils';
import { extractAndVerifyToken } from '../auth/token-utils';
import { getSchoolIdByCode } from './staff-attendance-common';

export interface RequestContext {
  schoolId: string;
  schoolCode: string;
  userId: string;
}

// Admin/oversight surface: resolve the school from X-School-Code. Mirrors leave/handler-util.
export async function resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<RequestContext | null> {
  const schoolCode = validateSchoolCodeHeader(event);
  const schoolId = await getSchoolIdByCode(schoolCode);
  if (!schoolId) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
    return null;
  }
  const userId = event.requestContext?.authorizer?.principalId || 'system';
  return { schoolId, schoolCode, userId };
}

// Employee /me surface: resolve the logged-in employee from the bearer token.
export function resolveEmployee(event: ApiEvent, callback: ApiCallback): { employeeId: string; schoolId: string } | null {
  const token = extractAndVerifyToken(getAuthorizationHeader(event));
  const employeeId = token?.employee_id || token?.id;
  if (!token || token.type !== 'employee' || !employeeId) {
    ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Employee login required', callback);
    return null;
  }
  return { employeeId, schoolId: token.school_id };
}

export function parseBody<T>(event: ApiEvent, callback: ApiCallback): T | null {
  if (!event.body) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
    return null;
  }
  try {
    return JSON.parse(event.body) as T;
  } catch {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid JSON body', callback);
    return null;
  }
}

// IST "today" (school-local), never a UTC slice. Lambda clock is UTC; add 5:30.
export function istTodayIso(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// First + last day of the IST current month (or of a given YYYY-MM-DD).
export function istMonthRange(dateIso?: string): { from: string; to: string } {
  const base = dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? new Date(`${dateIso}T00:00:00Z`) : new Date(Date.now() + 5.5 * 3600 * 1000);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export function requireParam(event: ApiEvent, name: string, callback: ApiCallback): string | null {
  const value = event.pathParameters?.[name];
  if (!value) {
    ResponseBuilder.badRequest(ErrorCode.MissingId, `${name} is required`, callback);
    return null;
  }
  return value;
}
