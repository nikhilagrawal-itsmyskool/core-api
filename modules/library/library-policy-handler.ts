import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchoolId, userIdOf } from "./library-common";
import { policyService } from "./library-policy-service";
import { UpdatePolicyRequest } from "./library-interfaces";
import { guard } from "../auth/authz";
import { LIBRARY_ACTIONS } from "./library-actions";

class PolicyHandler {
  public get = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const result = await policyService.get(schoolId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      if (!event.body) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "Request body is required",
          callback,
        );
        return;
      }
      const body: UpdatePolicyRequest = JSON.parse(event.body);
      const result = await policyService.update(
        schoolId,
        body,
        userIdOf(event),
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new PolicyHandler();
const g = (ref: string, fn: any) => guard(LIBRARY_ACTIONS[ref], fn);
export const get = g("library-policy-handler.get", handler.get);
export const update = g("library-policy-handler.update", handler.update);
