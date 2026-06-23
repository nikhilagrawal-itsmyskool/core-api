import { DB, singleLineString } from "../../shared/lib/db";
import { ApiCallback, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { validateSchoolCodeHeader } from "../auth/auth-utils";
import { BorrowerType } from "./library-constants";

// Resolve a school's internal uuid from its public code.
export async function getSchoolIdByCode(
  schoolCode: string,
): Promise<string | null> {
  const results = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return results.length > 0 ? results[0].uuid : null;
}

// Validate the school-code header and resolve it to a school uuid, writing a
// badRequest and returning null when the code is missing/unknown.
export async function resolveSchoolId(
  event: ApiEvent,
  callback: ApiCallback,
): Promise<string | null> {
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
  return schoolId;
}

export function userIdOf(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || "system";
}

// Look up a borrower's name from the relevant table, scoped to the school.
// Returns null when the borrower does not exist for that school.
export async function resolveBorrowerName(
  borrowerType: BorrowerType,
  borrowerId: string,
  schoolId: string,
): Promise<string | null> {
  const table = borrowerType === "student" ? "student" : "employee";
  const rows = await DB.query(
    singleLineString`select name from ${table} where uuid = $1 and school_id = $2`,
    [borrowerId, schoolId],
  );
  return rows.length > 0 ? rows[0].name : null;
}
