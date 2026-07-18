import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guardActiveStudent } from '../auth/auth-utils';
import { studentAdminService } from './student-admin-service';

// Parent-app profile: GET /student/me. The active child comes from the family
// token + X-Student-Id (resolveActiveStudent, no DB round-trip); schoolId comes
// from the token. Returns a curated profile — not the full admin record — so the
// app screen gets exactly what it renders and no internal fields leak.
class StudentMeHandler {
  public getMe = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;

      const schoolId = auth.token.school_id;
      const studentId = auth.activeStudentId;

      const detail: any = await studentAdminService.getDetail(studentId, schoolId);
      if (!detail) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Student not found', callback);
        return;
      }

      const profile = {
        id: detail.uuid,
        name: detail.name,
        admissionNumber: detail.admissionNumber,
        gender: detail.gender ?? null,
        dob: detail.dob ?? null,
        bloodGroupCode: detail.bloodGroupCode ?? null,
        className: detail.currentClassName ?? null,
        rollNumber: detail.currentRollNumber ?? null,
        academicYear: detail.currentAcademicYearId
          ? { id: detail.currentAcademicYearId, name: detail.currentAcademicYearName ?? null }
          : null,
        house: detail.houseName
          ? { name: detail.houseName, color: detail.houseColor ?? null }
          : null,
        photoId: detail.photoId ?? null,
        photoThumbId: detail.photoThumbId ?? null,
      };
      ResponseBuilder.ok(profile, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new StudentMeHandler();
export const getMe = handler.getMe;
