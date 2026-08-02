import { ApiCallback, ApiEvent } from '../../shared/lib/api.interfaces';
import { DB, singleLineString } from '../../shared/lib/db';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

export interface RequestContext {
  schoolId: string;
  userId: string;
}

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const results = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode]
  );
  return results.length > 0 ? results[0].uuid : null;
}

// Resolve the school from the X-School-Code header + the authenticated actor.
// On failure writes the error response and returns null so the caller can bail.
export async function resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<RequestContext | null> {
  const schoolCode = validateSchoolCodeHeader(event);
  const schoolId = await getSchoolIdByCode(schoolCode);
  if (!schoolId) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
    return null;
  }
  const userId = event.requestContext?.authorizer?.principalId || 'system';
  return { schoolId, userId };
}

export function parseBody<T>(event: ApiEvent, callback: ApiCallback): T | null {
  if (!event.body) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
    return null;
  }
  return JSON.parse(event.body) as T;
}

export function requireParam(event: ApiEvent, name: string, callback: ApiCallback): string | null {
  const value = event.pathParameters?.[name];
  if (!value) {
    ResponseBuilder.badRequest(ErrorCode.MissingId, `${name} is required`, callback);
    return null;
  }
  return value;
}

// Atomically allocate the next receipt number for (school, series, academic year).
// Returns a string like "FR-42". Safe under concurrency via the unique index + upsert.
export async function nextReceiptNo(schoolId: string, series: string, academicYearId: string): Promise<string> {
  const rows = await DB.query(
    singleLineString`
      insert into fee_receipt_counter (uuid, school_id, series, academic_year_id, last_no, updated_at)
      values ($1, $2, $3, $4, 1, $5)
      on conflict (school_id, series, academic_year_id)
      do update set last_no = fee_receipt_counter.last_no + 1, updated_at = $5
      returning last_no
    `,
    [generateShortUuid(12), schoolId, series, academicYearId, new Date()]
  );
  return `${series}-${rows[0].lastNo}`;
}
