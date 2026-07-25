import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader, getCallerContext } from '../auth/auth-utils';
import { maskContactFields } from '../../shared/util/mask-phone';
import { STUDENT_PHONE_FIELDS } from './student-constants';
import { studentService } from './student-service';
import { getSignedPhotoUrl } from '../../shared/lib/file-storage';

class StudentHandler {
  public search = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await studentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const q = event.queryStringParameters || {};
      const results = await studentService.search(schoolId, {
        name: q.name,
        classId: q.classId,
        academicYearId: q.academicYearId,
        admissionNumber: q.admissionNumber,
        phone: q.phone,
      });
      // Presign a photo URL per row only when the caller asks (the grid does; the
      // dropdown/search dialogs don't, so they skip the presign cost). The grid
      // pulls the full roster, so sign in bounded batches rather than one giant
      // Promise.all — firing thousands of concurrent SigV4 signings at once is
      // what OOM'd/timed-out the Lambda (a broad name=a matches the whole school).
      if (q.withPhotos === 'true') {
        const rows = (results as any[]).filter((r: any) => r.photoStorageKey);
        const BATCH = 25;
        for (let i = 0; i < rows.length; i += BATCH) {
          await Promise.all(
            rows.slice(i, i + BATCH).map(async (r: any) => {
              r.photoUrl = await getSignedPhotoUrl(r.photoStorageKey);
            })
          );
        }
      }
      (results as any[]).forEach((r: any) => delete r.photoStorageKey);
      // Contact numbers are admin/god-only on the roster/search surface.
      const reveal = getCallerContext(event).isAdminGod;
      (results as any[]).forEach((r: any) =>
        maskContactFields(r, [...STUDENT_PHONE_FIELDS], reveal)
      );
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Command-palette omni-search: GET /students/omni-search?q=&limit=
  public omni = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await studentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }
      const q = event.queryStringParameters || {};
      const limit = parseInt(q.limit || '15', 10) || 15;
      // Pin to the current session: current-year students rank first, the rest
      // follow as a greyed "not in <year>" block. Callers may override the scope
      // by passing academicYearId (or clear it entirely with academicYearId=all).
      const scope =
        q.academicYearId === 'all'
          ? null
          : q.academicYearId || (await studentService.getCurrentAcademicYearId(schoolId));
      const results = await studentService.omniSearch(schoolId, q.q || '', limit, scope);
      // Attach a short-lived presigned photo URL per row (so the palette renders
      // <img> straight from S3), then drop the internal storage key.
      await Promise.all(
        results.map(async (r: any) => {
          if (r.photoStorageKey) r.photoUrl = await getSignedPhotoUrl(r.photoStorageKey);
          delete r.photoStorageKey;
        })
      );
      ResponseBuilder.ok({ results }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Class strength board: GET /student/class-strength?academicYearId=
  // Defaults to the current session when academicYearId is omitted. Returns per
  // class the active head-count and the last admission (max admission_date).
  public classStrength = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await studentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }
      const q = event.queryStringParameters || {};
      const academicYearId = q.academicYearId || (await studentService.getCurrentAcademicYearId(schoolId));
      if (!academicYearId) {
        ResponseBuilder.ok({ academicYearId: null, classes: [] }, callback);
        return;
      }
      const classes = await studentService.classStrength(schoolId, academicYearId);
      ResponseBuilder.ok({ academicYearId, classes }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new StudentHandler();
export const search = handler.search;
export const omni = handler.omni;
export const classStrength = handler.classStrength;
