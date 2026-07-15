import { ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';

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

