import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
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
      // dropdown/search dialogs don't, so they skip the presign cost).
      if (q.withPhotos === 'true') {
        await Promise.all(
          (results as any[]).map(async (r: any) => {
            if (r.photoStorageKey) r.photoUrl = await getSignedPhotoUrl(r.photoStorageKey);
          })
        );
      }
      (results as any[]).forEach((r: any) => delete r.photoStorageKey);
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
      const results = await studentService.omniSearch(schoolId, q.q || '', limit);
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
}

const handler = new StudentHandler();
export const search = handler.search;
export const omni = handler.omni;
