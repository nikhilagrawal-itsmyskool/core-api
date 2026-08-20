import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { employeeAuthService, EmployeeLogin } from './employee-auth-service';
import { validateSchoolCodeHeader } from './auth-utils';
import { getClientIp, checkLock, recordFailure, recordSuccess } from './login-throttle';
import { turnstileEnabled, verifyTurnstile } from './turnstile';
import { registerDevice, isDeviceActive, listDevices, revokeDevice } from './device-session';

const DEVICE_TOKEN_TTL = '24h'; // short life so a portal revocation kills a lost device within a day
const bearer = (event: ApiEvent): string =>
  String((event.headers?.Authorization || (event.headers as any)?.authorization || '')).replace(/^Bearer\s+/i, '').trim();

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

      // A device login (deviceId present) registers a revocable device_session and gets a
      // short-lived, device-bound token that can be silently refreshed; a normal browser login
      // gets the usual 7-day token with no refresh path.
      const { deviceId, deviceLabel } = validated;
      const payload: any = {
        auth: process.env.JWT_MAGIC_KEY,
        id: employeeLogin.uuid,
        employee_id: employeeLogin.employeeId,
        login_name: username,
        school_id: schoolId,
        school_code: schoolCode,
        type: 'employee',
        roles: employeeLogin.roles,
      };
      let token: string;
      if (deviceId) {
        payload.device_id = deviceId;
        token = employeeAuthService.signToken(payload, DEVICE_TOKEN_TTL);
        await registerDevice(schoolId, employeeLogin.employeeId, username, deviceId, deviceLabel);
      } else {
        token = employeeAuthService.signToken(payload);
      }

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

  // Silent token refresh for a paired device (the desk voice device). Verifies the current
  // device-bound employee token and re-issues a fresh short-lived one — no password, no Turnstile.
  // Only a token carrying a device_id whose device_session is still ACTIVE can refresh, so
  // revoking the device from the portal stops renewal (it dies within the ~24h token life).
  // A fully-expired token fails → the manager must sign in again through the WebView.
  public async refresh(event: ApiEvent, _context: ApiContext, callback: ApiCallback) {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const token = bearer(event);
      if (!token) {
        ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Missing token', callback);
        return;
      }
      const decoded = employeeAuthService.verifyEmployeeToken(token);
      if (!decoded) {
        ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Token invalid or expired — please sign in again', callback);
        return;
      }
      const deviceId = decoded.device_id;
      if (!deviceId) {
        ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'This token cannot be refreshed', callback);
        return;
      }
      if (!(await isDeviceActive(decoded.school_id, deviceId))) {
        ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'This device has been revoked — please sign in again', callback);
        return;
      }
      const fresh = employeeAuthService.signToken(
        {
          auth: process.env.JWT_MAGIC_KEY,
          id: decoded.id,
          employee_id: decoded.employee_id,
          login_name: decoded.login_name,
          school_id: decoded.school_id,
          school_code: decoded.school_code,
          type: 'employee',
          roles: decoded.roles || [],
          device_id: deviceId,
        },
        DEVICE_TOKEN_TTL,
      );
      if (!fresh) {
        ResponseBuilder.badRequest(ErrorCode.GeneralError, 'Token cannot be generated', callback);
        return;
      }
      ResponseBuilder.ok({ token: fresh }, callback);
    } catch (err: any) {
      ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, err.message || 'Refresh failed', callback);
    }
  }

  // Admin-only device management (the kill-switch surface for the portal). Both self-verify an
  // admin/god employee token and scope to that token's school — no X-School-Code trust needed.
  private adminFromEvent(event: ApiEvent): any | null {
    const token = bearer(event);
    if (!token) return null;
    const decoded = employeeAuthService.verifyEmployeeToken(token);
    if (!decoded) return null;
    const roles: string[] = Array.isArray(decoded.roles) ? decoded.roles : [];
    return roles.includes('admin') || roles.includes('god') ? decoded : null;
  }

  public async devices(event: ApiEvent, _context: ApiContext, callback: ApiCallback) {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const admin = this.adminFromEvent(event);
      if (!admin) {
        ResponseBuilder.unauthorizedRequest(ErrorCode.MissingPermission, 'Admins only', callback);
        return;
      }
      const devices = await listDevices(admin.school_id);
      ResponseBuilder.ok({ devices }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  }

  public async revoke(event: ApiEvent, _context: ApiContext, callback: ApiCallback) {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const admin = this.adminFromEvent(event);
      if (!admin) {
        ResponseBuilder.unauthorizedRequest(ErrorCode.MissingPermission, 'Admins only', callback);
        return;
      }
      const deviceId = event.pathParameters?.deviceId as string;
      if (!deviceId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'deviceId is required', callback);
        return;
      }
      const revoked = await revokeDevice(admin.school_id, deviceId, admin.employee_id || admin.id);
      ResponseBuilder.ok({ revoked }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  }

  private _validateLoginRequest(
    event: ApiEvent,
    callback: ApiCallback
  ): { schoolCode: string; username: string; password: string; turnstileToken?: string; deviceId?: string; deviceLabel?: string } | null {
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

    return {
      schoolCode,
      username: username.trim(),
      password,
      turnstileToken: bodyObj.turnstileToken,
      deviceId: bodyObj.deviceId ? String(bodyObj.deviceId).slice(0, 64) : undefined,
      deviceLabel: bodyObj.deviceLabel ? String(bodyObj.deviceLabel).slice(0, 120) : undefined,
    };
  }
}

const handler = new EmployeeAuthHandler();
export const login = handler.login.bind(handler);
export const refresh = handler.refresh.bind(handler);
export const devices = handler.devices.bind(handler);
export const revoke = handler.revoke.bind(handler);
