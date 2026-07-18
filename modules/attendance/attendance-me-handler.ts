import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guardActiveStudent } from '../auth/auth-utils';
import { attendanceService } from './attendance-service';

// Parent-app attendance: GET /attendance/me?from=&to=&academicYearId=
// Active child from the family token + X-Student-Id; schoolId from the token.
class AttendanceMeHandler {
  public getMy = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;

      const schoolId = auth.token.school_id;
      const studentId = auth.activeStudentId;
      const q = event.queryStringParameters || {};

      const result = await attendanceService.getStudentAttendance(schoolId, studentId, {
        academicYearId: q.academicYearId,
        from: q.from,
        to: q.to,
      });
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new AttendanceMeHandler();
export const getMy = handler.getMy;
