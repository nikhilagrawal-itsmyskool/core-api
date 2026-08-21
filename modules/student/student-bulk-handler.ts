import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader, getCallerContext } from '../auth/auth-utils';
import { maskContactFields } from '../../shared/util/mask-phone';
import { studentService } from './student-service';
import { studentAdminService } from './student-admin-service';
import { BulkUpdateRequest } from './student-interfaces';
import { guard } from '../auth/authz';
import { STUDENT_ACTIONS } from './student-actions';

function userId(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

// Contact columns the roster returns, masked for anyone who isn't admin/god (the
// bulk-edit screen is admin/god only, gated in the UI on top of the manage guard).
const ROSTER_CONTACT_FIELDS = [
  'fatherMobile', 'fatherWhatsapp',
  'motherMobile', 'motherWhatsapp',
  'guardianMobile', 'guardianWhatsapp',
];

class StudentBulkHandler {
  private async resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await studentService.getSchoolIdByCode(schoolCode);
    if (!schoolId) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
      return null;
    }
    return schoolId;
  }

  // GET /bulk-class?classId=&academicYearId=
  public roster = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;

      const q = event.queryStringParameters || {};
      if (!q.classId || !q.academicYearId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'classId and academicYearId are required', callback);
        return;
      }

      const students = await studentAdminService.bulkClassRoster(schoolId, q.classId, q.academicYearId);
      const reveal = getCallerContext(event).isAdminGod;
      (students as any[]).forEach((r) => maskContactFields(r, ROSTER_CONTACT_FIELDS, reveal));
      ResponseBuilder.ok({ students }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /bulk-update  { classId, academicYearId, items: [...] }
  public apply = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: BulkUpdateRequest = JSON.parse(event.body);
      const result = await studentAdminService.bulkUpdate(body, schoolId, userId(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new StudentBulkHandler();
export const roster = guard(STUDENT_ACTIONS['student-bulk-handler.roster'], handler.roster);
export const apply = guard(STUDENT_ACTIONS['student-bulk-handler.apply'], handler.apply);
