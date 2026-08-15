import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { validateSchoolCodeHeader } from './auth-utils';
import { getClientIp } from './login-throttle';
import { recoveryService, UserType, Purpose } from './recovery-service';

// Public (authorizer-exempt) forgot-username / forgot-password endpoints. The auth
// module has no verify-token authorizer, so these are reachable without a login —
// which is the whole point (the user has lost their credentials). Hardening lives in
// recovery-service.ts (rate limit, attempt cap, one-shot tokens, anti-enumeration).

const VALID_USER_TYPES: UserType[] = ['parent', 'staff'];
const VALID_PURPOSES: Purpose[] = ['username', 'password'];

class RecoveryHandler {
  // POST /auth/recover/request-otp  { userType, purpose, phone }
  public async requestOtp(event: ApiEvent, context: ApiContext, callback: ApiCallback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const body = this._body(event);
      if (!body) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);

      const userType = body.userType;
      const purpose = body.purpose;
      const phone = String(body.phone || '').replace(/\D/g, '');

      if (!VALID_USER_TYPES.includes(userType)) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "userType must be 'parent' or 'staff'", callback);
      }
      if (!VALID_PURPOSES.includes(purpose)) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "purpose must be 'username' or 'password'", callback);
      }
      if (phone.length < 10) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'A valid phone number is required', callback);
      }

      const schoolId = await recoveryService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid school code: ${schoolCode}`, callback);
      }

      const result = await recoveryService.requestOtp({
        schoolId,
        schoolCode,
        userType,
        purpose,
        phone,
        ip: getClientIp(event),
        userAgent: this._userAgent(event),
      });

      // Generic, enumeration-safe message. Same shape whether or not the phone matched.
      ResponseBuilder.ok(
        {
          otpId: result.otpId,
          expiresInSec: result.expiresInSec,
          resendInSec: result.resendInSec,
          message: 'If an account matches this number, a verification code has been sent by SMS.',
          ...(result.devCode ? { devCode: result.devCode } : {}),
        },
        callback
      );
    } catch (err: any) {
      // Cooldown / rate-limit come back as plain Errors — surface the message.
      ResponseBuilder.badRequest(ErrorCode.GeneralError, err.message || 'Could not process the request', callback);
    }
  }

  // POST /auth/recover/verify-otp  { otpId, code }
  public async verifyOtp(event: ApiEvent, context: ApiContext, callback: ApiCallback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const body = this._body(event);
      if (!body) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);

      const otpId = String(body.otpId || '').trim();
      const code = String(body.code || '').trim();
      if (!otpId || !code) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'otpId and code are required', callback);
      }

      const schoolId = await recoveryService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid school code: ${schoolCode}`, callback);
      }

      const result = await recoveryService.verifyOtp(schoolId, otpId, code, getClientIp(event), this._userAgent(event));

      if (result.purpose === 'username') {
        return ResponseBuilder.ok({ purpose: 'username', usernames: result.usernames || [] }, callback);
      }
      return ResponseBuilder.ok({ purpose: 'password', resetToken: result.resetToken }, callback);
    } catch (err: any) {
      ResponseBuilder.badRequest(ErrorCode.GeneralError, err.message || 'Could not verify the code', callback);
    }
  }

  // POST /auth/recover/set-password  { resetToken, newPassword }
  public async setPassword(event: ApiEvent, context: ApiContext, callback: ApiCallback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const body = this._body(event);
      if (!body) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);

      const resetToken = String(body.resetToken || '').trim();
      const newPassword = String(body.newPassword || '');
      if (!resetToken || !newPassword) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'resetToken and newPassword are required', callback);
      }

      const schoolId = await recoveryService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid school code: ${schoolCode}`, callback);
      }

      await recoveryService.setPassword(schoolId, resetToken, newPassword, getClientIp(event), this._userAgent(event));
      ResponseBuilder.ok({ message: 'Your password has been reset. You can now log in with your new password.' }, callback);
    } catch (err: any) {
      ResponseBuilder.badRequest(ErrorCode.GeneralError, err.message || 'Could not reset the password', callback);
    }
  }

  private _body(event: ApiEvent): any | null {
    if (!event.body) return null;
    try {
      return JSON.parse(event.body);
    } catch {
      return null;
    }
  }

  private _userAgent(event: ApiEvent): string | undefined {
    const h = (event.headers || {}) as any;
    return h['User-Agent'] || h['user-agent'] || undefined;
  }
}

const handler = new RecoveryHandler();
export const requestOtp = handler.requestOtp.bind(handler);
export const verifyOtp = handler.verifyOtp.bind(handler);
export const setPassword = handler.setPassword.bind(handler);
