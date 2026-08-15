import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { employeeAuthService, EmployeeLogin } from './employee-auth-service';
import { validateSchoolCodeHeader } from './auth-utils';
import { getClientIp, checkLock, recordFailure, recordSuccess } from './login-throttle';
import { turnstileEnabled, verifyTurnstile } from './turnstile';

class EmployeeAuthHandler {

  public async login(event: ApiEvent, _context: ApiContext, callback: ApiCallback) {
    _context.callbackWaitsForEmptyEventLoop = false;

    const validated = this._validateLoginRequest(event, callback);
    if (!validated) {
      return;
    }

    const { schoolCode, username, password, turnstileToken } = validated;

    try {
      const schoolId = await employeeAuthService.getSchoolIdByCode(schoolCode);

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

      // Bot guard: verify the Cloudflare Turnstile token (no-op unless TURNSTILE_SECRET
      // is set). Runs before the password check so bots can't spend guess attempts.
      if (turnstileEnabled() && !(await verifyTurnstile(turnstileToken, ip))) {
        ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Bot check failed. Please refresh the page and try again.', callback);
        return;
      }

      const employeeLogin: EmployeeLogin | null = await employeeAuthService.validateUsernameAndPassword(
        username,
        password,
        schoolId
      );

      if (!employeeLogin) {
        await recordFailure(schoolId, username, ip);
        ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Invalid username or password', callback);
        return;
      }
      await recordSuccess(schoolId, username);

      const token: string = employeeAuthService.signToken({
        auth: process.env.JWT_MAGIC_KEY,
        id: employeeLogin.uuid,
        employee_id: employeeLogin.employeeId,
        login_name: username,
        school_id: schoolId,
        school_code: schoolCode,
        type: 'employee',
        roles: employeeLogin.roles,
      });

      if (!token) {
        console.log('Token is null or undefined');
        ResponseBuilder.badRequest(ErrorCode.GeneralError, 'Token cannot be generated', callback);
        return;
      }

      // Step 5: Return successful response
      const resp = {
        token: token,
        displayName: employeeLogin.displayName,
        mustChangePassword: employeeLogin.mustChangePassword,
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
  ): { schoolCode: string; username: string; password: string; turnstileToken?: string } | null {
    // Validate request body
    if (event.body == null || event.body === undefined) {
      ResponseBuilder.badRequest(ErrorCode.GeneralError, 'Username and password required', callback);
      return null;
    }

    // Extract and validate school code from header
    let schoolCode: string;
    try {
      schoolCode = validateSchoolCodeHeader(event);
    } catch (err: any) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, err.message, callback);
      return null;
    }

    // Parse request body
    let bodyObj: any;
    try {
      bodyObj = JSON.parse(event.body);
    } catch (err) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid JSON in request body', callback);
      return null;
    }

    const username = bodyObj.username;
    const password = bodyObj.password;

    // Validate required fields
    if (!username || username.trim() === '' || !password || password.trim() === '') {
      ResponseBuilder.badRequest(ErrorCode.GeneralError, 'Username and password are required', callback);
      return null;
    }

    return { schoolCode, username: username.trim(), password, turnstileToken: bodyObj.turnstileToken };
  }
}

const handler = new EmployeeAuthHandler();
export const login = handler.login.bind(handler);
