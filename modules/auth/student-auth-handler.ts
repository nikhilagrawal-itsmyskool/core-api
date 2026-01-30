import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { studentAuthService, StudentLogin } from './student-auth-service';
import { validateSchoolCodeHeader } from './auth-utils';

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

      const studentLogin: StudentLogin | null = await studentAuthService.validateUsernameAndPassword(
        username,
        password,
        schoolId
      );

      if (!studentLogin) {
        ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Invalid username or password', callback);
        return;
      }

      const token: string = studentAuthService.signToken({
        auth: process.env.JWT_MAGIC_KEY,
        id: studentLogin.uuid,
        login_name: username,
        school_id: schoolId,
        school_code: schoolCode,
        type: 'student',
      });

      if (!token) {
        console.log('Token is null or undefined');
        ResponseBuilder.badRequest(ErrorCode.GeneralError, 'Token cannot be generated', callback);
        return;
      }

      const resp = {
        token: token,
        displayName: studentLogin.displayName,
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
