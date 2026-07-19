import { ApiCallback, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  validateSchoolCodeHeader,
  getSchoolCodeFromHeader,
  guardActiveStudent,
} from "../auth/auth-utils";
import { getSchoolIdByCode } from "./syllabus-common";

export interface RequestContext {
  schoolId: string;
  schoolCode: string;
  userId: string;
}

// Resolve the school from the X-School-Code header. On failure, writes the
// appropriate error response and returns null so the caller can bail out.
export async function resolveSchool(
  event: ApiEvent,
  callback: ApiCallback,
): Promise<RequestContext | null> {
  const schoolCode = validateSchoolCodeHeader(event);
  const schoolId = await getSchoolIdByCode(schoolCode);
  if (!schoolId) {
    ResponseBuilder.badRequest(
      ErrorCode.InvalidInput,
      "Invalid school code",
      callback,
    );
    return null;
  }
  const userId = event.requestContext?.authorizer?.principalId || "system";
  return { schoolId, schoolCode, userId };
}

export function parseBody<T>(event: ApiEvent, callback: ApiCallback): T | null {
  if (!event.body) {
    ResponseBuilder.badRequest(
      ErrorCode.InvalidInput,
      "Request body is required",
      callback,
    );
    return null;
  }
  return JSON.parse(event.body) as T;
}

export function requireParam(
  event: ApiEvent,
  name: string,
  callback: ApiCallback,
): string | null {
  const value = event.pathParameters?.[name];
  if (!value) {
    ResponseBuilder.badRequest(
      ErrorCode.MissingId,
      `${name} is required`,
      callback,
    );
    return null;
  }
  return value;
}

export { getSchoolCodeFromHeader, guardActiveStudent };
