import { ApiCallback, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { can } from '../../shared/lib/authz-policy';
import { extractAndVerifyToken } from './token-utils';
import { getAuthorizationHeader, getSchoolCodeFromHeader } from './auth-utils';

// Central backend authorization. Authentication (a valid JWT) is enforced by the
// gateway authorizer; this adds the missing AUTHORIZATION layer: does the caller's
// role actually grant the action? The policy itself lives in shared/lib/authz-policy.ts
// (a port of the admin-portal permission model). Handlers call `requireAction` as a
// one-line guard, mirroring the existing `guardActiveStudent` null-return idiom.

export interface Caller {
  type: string; // 'employee' | 'student'
  employeeId?: string; // employee uuid (employee tokens only)
  loginId: string; // token.id (employee uuid or family login id)
  loginName: string;
  schoolId: string;
  schoolCode: string;
  roles: string[]; // [] for student tokens
  students?: Array<{ id: string; name: string }>;
}

// serverless-offline sets IS_OFFLINE='true' for the local stack (never set in a real
// Lambda), so this is the one safe signal that we are running locally.
function isOffline(): boolean {
  return process.env.IS_OFFLINE === 'true';
}

// Parse roles off the sls-offline-authorizer-override context. serverless-offline may
// surface them as an array or a comma-string depending on how the test supplies them.
function parseOverrideRoles(authorizer: any): string[] | null {
  const raw = authorizer && authorizer.roles;
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.map((r) => String(r));
  return String(raw)
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

// Local-only fallback: under `--noAuth` there is no verifiable bearer, so synthesize a
// caller from the offline override context. Defaults to a god caller so the existing
// jest suites (which send no token) keep passing; negative tests pass explicit roles.
// Returns null in every deployed stage, so prod/dev genuinely require a real token.
function offlineFallbackCaller(event: ApiEvent): Caller | null {
  if (!isOffline()) return null;
  const authorizer: any = event.requestContext && (event.requestContext as any).authorizer;
  const roles = parseOverrideRoles(authorizer) || ['god'];
  const principal = (authorizer && authorizer.principalId) || 'offline';
  return {
    type: (authorizer && authorizer.type) || 'employee',
    employeeId: principal,
    loginId: principal,
    loginName: principal,
    schoolId: '',
    schoolCode: getSchoolCodeFromHeader(event) || '',
    roles,
    students: undefined,
  };
}

// Verified identity from the bearer token, or null. Falls back to the offline context
// only when running locally (section above).
export function getCaller(event: ApiEvent): Caller | null {
  const token = extractAndVerifyToken(getAuthorizationHeader(event));
  if (!token) return offlineFallbackCaller(event);
  return {
    type: token.type,
    employeeId: token.employee_id,
    loginId: token.id,
    loginName: token.login_name,
    schoolId: token.school_id,
    schoolCode: token.school_code,
    roles: Array.isArray(token.roles) ? token.roles : [],
    students: token.students,
  };
}

// Cross-tenant guard: the (spoofable) X-School-Code header must agree with the token's
// signed school_code. Tolerant when the header or token school is absent (health,
// student flows, offline fallback) so it never breaks those paths.
function sameSchool(event: ApiEvent, caller: Caller): boolean {
  const header = getSchoolCodeFromHeader(event);
  if (!header || !caller.schoolCode) return true;
  return header.trim().toLowerCase() === caller.schoolCode.trim().toLowerCase();
}

// THE central gate. On success returns the Caller; on failure it writes the response
// (401 no/invalid token, 403 wrong school or missing permission) and returns null, so
// the handler does `const caller = requireAction(...); if (!caller) return;`.
export function requireAction(event: ApiEvent, action: string, callback: ApiCallback): Caller | null {
  const caller = getCaller(event);
  if (!caller) {
    ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Authentication required', callback);
    return null;
  }
  if (!sameSchool(event, caller)) {
    ResponseBuilder.forbidden(ErrorCode.MissingPermission, 'School mismatch', callback);
    return null;
  }
  if (!can(caller.roles, action)) {
    ResponseBuilder.forbidden(ErrorCode.MissingPermission, `Missing permission: ${action}`, callback);
    return null;
  }
  return caller;
}
