import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { validateSchoolCodeHeader } from "../auth/auth-utils";
import { guard } from "../auth/authz";
import { COMMUNICATION_ACTIONS } from "./communication-actions";
import { messagePolicyService } from "./message-policy-service";

// The god-only message-type registry screen (communication.config.*).
class MessagePolicyHandler {
  private async school(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
    const schoolId = await messagePolicyService.getSchoolIdByCode(validateSchoolCodeHeader(event));
    if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Invalid school code", callback); return null; }
    return schoolId;
  }
  private userId(event: ApiEvent): string {
    return event.requestContext?.authorizer?.principalId || "system";
  }

  // GET /communication/config/message-policies
  public list = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.school(event, callback);
      if (!schoolId) return;
      ResponseBuilder.ok({ types: await messagePolicyService.list(schoolId) }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /communication/config/message-policies  { key, label, group, templateKey, inApp, sms, whatsapp, studentPref }
  public create = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.school(event, callback);
      if (!schoolId) return;
      const body = event.body ? JSON.parse(event.body) : {};
      const res = await messagePolicyService.create(schoolId, body, this.userId(event));
      if (!res.ok) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, res.reason || "Could not create", callback);
      ResponseBuilder.ok({ types: await messagePolicyService.list(schoolId) }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /communication/config/message-policies/{key}  { label, group, templateKey, inApp, sms, whatsapp, studentPref }
  public update = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.school(event, callback);
      if (!schoolId) return;
      const key = event.pathParameters?.key;
      if (!key) return ResponseBuilder.badRequest(ErrorCode.MissingId, "message key is required", callback);
      const body = event.body ? JSON.parse(event.body) : {};
      const ok = await messagePolicyService.update(schoolId, key, body, this.userId(event));
      if (!ok) return ResponseBuilder.notFound(ErrorCode.InvalidId, `Unknown message type: ${key}`, callback);
      ResponseBuilder.ok({ types: await messagePolicyService.list(schoolId) }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new MessagePolicyHandler();
export const list = guard(COMMUNICATION_ACTIONS["message-policy-handler.list"], h.list);
export const create = guard(COMMUNICATION_ACTIONS["message-policy-handler.create"], h.create);
export const update = guard(COMMUNICATION_ACTIONS["message-policy-handler.update"], h.update);
