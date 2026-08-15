import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { studentAuthService, FamilyLogin } from './student-auth-service';
import { validateSchoolCodeHeader } from './auth-utils';
import { getClientIp, checkLock, recordFailure, recordSuccess } from './login-throttle';

class StudentAuthHandler {

  public async login(event: ApiEvent, _context: ApiContext, callback: ApiCallback) {
    _context.callbackWaitsForEmptyEventLoop = false;

    const validated = this._validateLoginRequest(event, callback);
    if (!validated) {
      return;
    }

    const { schoolCode, username, password } = validated;

    try {
      const schoolId = await studentAuthService.getSchoolIdByCode(schoolCode);

      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid school code: ${schoolCode}`, callback);
        return;
      }

      // Brute-force guard: refuse before checking the password if this account/IP is locked.
      const ip = getClientIp(event);
      const lock = await checkLock(schoolId, username, ip);
      if (lock.locked) {
        ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, `Too many login attempts. Please try again in about ${Math.ceil(lock.retryAfterSec / 60)} minute(s).`, callback);
        return;
      }

      const familyLogin: FamilyLogin | null = await studentAuthService.validateFamilyLogin(
        username,
        password,
        schoolId
      );

      if (!familyLogin) {
        await recordFailure(schoolId, username, ip);
        ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Invalid username or password', callback);
        return;
      }
      await recordSuccess(schoolId, username);

      const token: string = studentAuthService.signToken({
        auth: process.env.JWT_MAGIC_KEY,
        id: familyLogin.loginId,
        login_name: username,
        school_id: schoolId,
        school_code: schoolCode,
        type: 'student',
        // Sibling ids the app may act as; doubles as the X-Student-Id allowlist.
        students: familyLogin.students.map((s) => ({ id: s.id, name: s.name })),
      });

      if (!token) {
        console.log('Token is null or undefined');
        ResponseBuilder.badRequest(ErrorCode.GeneralError, 'Token cannot be generated', callback);
        return;
      }

      const resp = {
        token: token,
        students: familyLogin.students,
      };
      ResponseBuilder.ok(resp, callback);
    } catch (err: any) {
      console.error('Error during authentication:', err);
      ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, err.message || 'Authentication failed', callback);
    }
  }

  private _validateLoginRequest(
    event: ApiEvent,
    callback: ApiCallback
  ): { schoolCode: string; username: string; password: string } | null {
    if (event.body == null || event.body === undefined) {
      ResponseBuilder.badRequest(ErrorCode.GeneralError, 'Username and password required', callback);
      return null;
    }

    let schoolCode: string;
    try {
      schoolCode = validateSchoolCodeHeader(event);
    } catch (err: any) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, err.message, callback);
      return null;
    }

    let bodyObj: any;
    try {
      bodyObj = JSON.parse(event.body);
    } catch (err) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid JSON in request body', callback);
      return null;
    }

    const username = bodyObj.username;
    const password = bodyObj.password;

    if (!username || username.trim() === '' || !password || password.trim() === '') {
      ResponseBuilder.badRequest(ErrorCode.GeneralError, 'Username and password are required', callback);
      return null;
    }

    return { schoolCode, username: username.trim(), password };
  }
}

const handler = new StudentAuthHandler();
export const login = handler.login.bind(handler);
