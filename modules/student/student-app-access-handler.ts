import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { studentService } from './student-service';
import { studentAdminService } from './student-admin-service';
import { guard } from '../auth/authz';
import { STUDENT_ACTIONS } from './student-actions';

// Admin-facing management of the PARENT APP's access — the family logins, the children each
// opens, and password resets. Distinct from student-me-handler (which the app itself calls);
// these are staff screens ("App Access") behind student.record.manage.

function userId(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

// A short, easy-to-read auto password for parents (admin reads it out): 2 letters + 4 digits,
// avoiding look-alike characters (no O/0, I/1, L).
function genPassword(): string {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  return pick(letters) + pick(letters) + pick(digits) + pick(digits) + pick(digits) + pick(digits);
}

async function resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
  const schoolCode = validateSchoolCodeHeader(event);
  const schoolId = await studentService.getSchoolIdByCode(schoolCode);
  if (!schoolId) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
    return null;
  }
  return schoolId;
}

class StudentAppAccessHandler {
  // GET /app-logins?search= — every family app login + the children each covers.
  public listAppLogins = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const logins = await studentAdminService.listAppLogins(schoolId, event.queryStringParameters?.search);
      ResponseBuilder.ok({ logins }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /app-logins/reset { username, mode: 'auto'|'manual', password? } → { username, password }.
  public resetFamilyPassword = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const body = JSON.parse(event.body || '{}');
      const username = (body.username || '').trim();
      if (!username) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'username is required', callback); return; }
      let password: string;
      if (body.mode === 'manual') {
        password = (body.password || '').trim();
        if (password.length < 4) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Password must be at least 4 characters', callback); return; }
      } else {
        password = genPassword();
      }
      const ok = await studentAdminService.setFamilyPassword(schoolId, username, password, userId(event));
      if (!ok) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'No app login found for this number', callback); return; }
      ResponseBuilder.ok({ username, password }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new StudentAppAccessHandler();
export const listAppLogins = guard(STUDENT_ACTIONS['student-app-access-handler.listAppLogins'], handler.listAppLogins);
export const resetFamilyPassword = guard(STUDENT_ACTIONS['student-app-access-handler.resetFamilyPassword'], handler.resetFamilyPassword);
