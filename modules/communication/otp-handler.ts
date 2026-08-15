import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { resolveSchool, parseBody } from './handler-util';
import { otpSendService } from './otp-send-service';

// POST /communication/otp  { toNumber, code }
// Machine-to-machine only: sits behind the verify-token authorizer and is called by
// auth's recovery-service with a short-lived service token. Sends an OTP SMS inline
// (no queue) so the caller learns immediately whether the code was dispatched.
class OtpHandler {
  public async send(event: ApiEvent, context: ApiContext, callback: ApiCallback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;

      const body = parseBody<{ toNumber?: string; code?: string }>(event, callback);
      if (!body) return;

      const toNumber = String(body.toNumber || '').trim();
      const code = String(body.code || '').trim();
      if (!toNumber || !code) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'toNumber and code are required', callback);
      }

      const result = await otpSendService.send(ctx.schoolId, toNumber, code);
      if (result.status !== 'sent') {
        return ResponseBuilder.badRequest(ErrorCode.GeneralError, result.error || 'Failed to send OTP', callback);
      }
      ResponseBuilder.ok({ status: 'sent', providerMessageId: result.providerMessageId }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  }
}

const handler = new OtpHandler();
export const send = handler.send.bind(handler);
