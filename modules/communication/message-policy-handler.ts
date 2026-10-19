import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { validateSchoolCodeHeader } from "../auth/auth-utils";
import { guard } from "../auth/authz";
import { COMMUNICATION_ACTIONS } from "./communication-actions";
import { messagePolicyService } from "./message-policy-service";

// Per-school message-routing policy (which channels each message type uses). God-only
// screen in the communication module (communication.config.*).
class MessagePolicyHandler {
  // GET /communication/config/message-policies
  public list = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await messagePolicyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Invalid school code", callback);
      const types = await messagePolicyService.list(schoolId);
      ResponseBuilder.ok({ types }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /communication/config/message-policies/{key}  { inApp, sms, whatsapp, studentPref }
  public update = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await messagePolicyService.getSchoolIdByCode(schoolCode);
      if (!schoolId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Invalid school code", callback);
      const key = event.pathParameters?.key;
      if (!key) return ResponseBuilder.badRequest(ErrorCode.MissingId, "message key is required", callback);
      const body = event.body ? JSON.parse(event.body) : {};
      const channels = {
        inApp: !!body.inApp,
        sms: !!body.sms,
        whatsapp: !!body.whatsapp,
        studentPref: !!body.studentPref,
      };
      const userId = event.requestContext?.authorizer?.principalId || "system";
      const ok = await messagePolicyService.upsert(schoolId, key, channels, userId);
      if (!ok) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Unknown message type: ${key}`, callback);
      const types = await messagePolicyService.list(schoolId);
      ResponseBuilder.ok({ types }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new MessagePolicyHandler();
export const list = guard(COMMUNICATION_ACTIONS["message-policy-handler.list"], h.list);
export const update = guard(COMMUNICATION_ACTIONS["message-policy-handler.update"], h.update);
