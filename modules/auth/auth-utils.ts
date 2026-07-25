import { ApiCallback, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { DecodedToken, extractAndVerifyToken } from './token-utils';

export function getSchoolCodeFromHeader(event: ApiEvent): string | null {
  const headers = event.headers || {};
  
  // Try case-insensitive lookup (API Gateway may lowercase headers)
  const schoolCode = 
    headers['X-School-Code'] || 
    headers['x-school-code'] ||
    headers['X-SCHOOL-CODE'] ||
    null;
  
  return schoolCode;
}

export function validateSchoolCodeHeader(event: ApiEvent): string {
  const schoolCode = getSchoolCodeFromHeader(event);

  if (!schoolCode || schoolCode.trim() === '') {
    throw new Error(`${ErrorCode.InvalidInput}: School code header (X-School-Code) is required`);
  }

  return schoolCode.trim();
}

// ---- Active-student (family login) context ----
// The student app logs in as a family and picks an active child. That child's id
// travels on every request as `X-Student-Id`. Because the JWT already carries the
// family's student-id list, authorizing the header is a pure in-token membership
// check — no DB round-trip. Wire these into student-facing data endpoints as they
// are built.

export function getActiveStudentIdFromHeader(event: ApiEvent): string | null {
  const headers = event.headers || {};
  return (
    headers['X-Student-Id'] ||
    headers['x-student-id'] ||
    headers['X-STUDENT-ID'] ||
    null
  );
}

// Returns true if `studentId` is one of the sibling ids embedded in the token.
export function assertStudentInToken(
  studentId: string | null | undefined,
  token: { students?: Array<{ id: string }> } | null | undefined
): boolean {
  if (!studentId || !token || !Array.isArray(token.students)) {
    return false;
  }
  return token.students.some((s) => s && s.id === studentId);
}

export function getAuthorizationHeader(event: ApiEvent): string | undefined {
  const headers = event.headers || {};
  return headers['Authorization'] || headers['authorization'] || undefined;
}

// ---- Contact-visibility context ----
// Who is allowed to see un-masked mobile/WhatsApp numbers. Derived purely from the
// verified bearer token (no DB round-trip). A missing/invalid token yields the most
// restrictive context (nothing revealed) — safe by default.

export interface CallerContext {
  isAdminGod: boolean; // employee with the 'admin' or 'god' role → sees every number
  employeeId?: string; // own employee uuid → sees own number (self exception)
  familyStudentIds: string[]; // family login's child allowlist → sees own family numbers
}

export function getCallerContext(event: ApiEvent): CallerContext {
  const token = extractAndVerifyToken(getAuthorizationHeader(event));
  if (!token) {
    return { isAdminGod: false, familyStudentIds: [] };
  }
  const roles = Array.isArray(token.roles) ? token.roles : [];
  return {
    isAdminGod: token.type === 'employee' && (roles.includes('admin') || roles.includes('god')),
    employeeId: token.employee_id,
    familyStudentIds: Array.isArray(token.students) ? token.students.map((s) => s.id) : [],
  };
}

// Reveal an employee's own number: admin/god, or the caller viewing their own record.
export function revealEmployee(ctx: CallerContext, employeeId: string | null | undefined): boolean {
  return ctx.isAdminGod || (!!employeeId && ctx.employeeId === employeeId);
}

// Reveal a student's / their guardian's number: admin/god, or a family login that
// includes that student.
export function revealStudent(ctx: CallerContext, studentId: string | null | undefined): boolean {
  return ctx.isAdminGod || (!!studentId && ctx.familyStudentIds.includes(studentId));
}

export interface ActiveStudentAuth {
  token: DecodedToken;
  activeStudentId: string;
}

// Why each failure is distinct: the app reacts differently to each — re-login on
// 'unauthenticated', prompt a child pick on 'missing-student', hard-stop on 'forbidden'.
export type StudentAuthFailure =
  | { reason: 'unauthenticated'; message: string } // no/invalid token, or not a student token → 401
  | { reason: 'missing-student'; message: string } // token ok but no X-Student-Id → 400
  | { reason: 'forbidden'; message: string }; //     X-Student-Id not in the family → 403

// The single guard every student-app data endpoint calls first. Verifies the
// bearer token, reads X-Student-Id, and asserts the child belongs to the family
// login — all in-token, no DB round-trip. On success the handler proceeds with
// `auth.activeStudentId` (already authorized) and `auth.token` (school_id etc.).
export function resolveActiveStudent(
  event: ApiEvent
): { ok: true; auth: ActiveStudentAuth } | { ok: false; failure: StudentAuthFailure } {
  const token = extractAndVerifyToken(getAuthorizationHeader(event));
  if (!token || token.type !== 'student') {
    return { ok: false, failure: { reason: 'unauthenticated', message: 'Invalid or missing student token' } };
  }

  const studentId = getActiveStudentIdFromHeader(event);
  if (!studentId) {
    return { ok: false, failure: { reason: 'missing-student', message: 'X-Student-Id header is required' } };
  }

  if (!assertStudentInToken(studentId, token)) {
    return { ok: false, failure: { reason: 'forbidden', message: 'Student is not part of this family login' } };
  }

  return { ok: true, auth: { token, activeStudentId: studentId } };
}

// Maps a guard failure onto the matching HTTP response. Handlers do:
//   const a = resolveActiveStudent(event);
//   if (!a.ok) return respondStudentAuthFailure(a.failure, callback);
export function respondStudentAuthFailure(failure: StudentAuthFailure, callback: ApiCallback): void {
  switch (failure.reason) {
    case 'unauthenticated':
      return ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, failure.message, callback);
    case 'missing-student':
      return ResponseBuilder.badRequest(ErrorCode.InvalidInput, failure.message, callback);
    case 'forbidden':
      return ResponseBuilder.forbidden(ErrorCode.GeneralError, failure.message, callback);
  }
}

// One-call guard for student-app handlers: on success returns the authorized
// ActiveStudentAuth; on failure it writes the matching error response and returns
// null, so the handler just does `if (!auth) return;`. (Narrows positively, which
// is required because this project compiles with strictNullChecks off.)
export function guardActiveStudent(event: ApiEvent, callback: ApiCallback): ActiveStudentAuth | null {
  const result = resolveActiveStudent(event);
  if (result.ok) {
    return result.auth;
  }
  // strictNullChecks is off, so the complement of `result.ok` doesn't narrow the
  // union — assert the failure member explicitly (safe: we're in the !ok branch).
  respondStudentAuthFailure((result as { failure: StudentAuthFailure }).failure, callback);
  return null;
}

