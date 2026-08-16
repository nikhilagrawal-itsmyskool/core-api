import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, isGodCaller } from "./handler-util";
import { guard } from '../auth/authz';
import { ASSISTANT_ACTIONS } from './assistant-actions';
import { ask as askService, AskInput } from "./assistant-service";

class AssistantHandler {
  // POST /assistant/ask { question, context? }
  public ask = async (event: ApiEvent, ctx: ApiContext, cb: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      // The assistant runs with a god token (unmasked contacts) and exposes the whole read
      // surface — restrict its use to god callers only.
      if (!isGodCaller(event)) {
        return ResponseBuilder.forbidden(ErrorCode.MissingPermission, "The assistant is available to god-role users only.", cb);
      }
      const auth = await resolveSchool(event, cb);
      if (!auth) return;
      const body = parseBody<AskInput>(event, cb);
      if (!body) return;
      if (!body.question || !body.question.trim()) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "question is required", cb);
      }
      const result = await askService(
        { schoolCode: auth.schoolCode, authorization: auth.authorization },
        auth.schoolId,
        body,
      );
      ResponseBuilder.ok(result, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };
}

const h = new AssistantHandler();
export const ask = guard(ASSISTANT_ACTIONS['assistant-handler.ask'], h.ask);
