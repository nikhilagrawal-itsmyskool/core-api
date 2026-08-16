import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { studentService } from './student-service';
import { studentSiblingService } from './student-sibling-service';
import { guard } from '../auth/authz';
import { STUDENT_ACTIONS } from './student-actions';

function userId(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

class StudentSiblingHandler {
  private async resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await studentService.getSchoolIdByCode(schoolCode);
    if (!schoolId) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
      return null;
    }
    return schoolId;
  }

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const studentId = event.pathParameters?.id;
      if (!studentId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Student ID is required', callback); return; }
      const results = await studentSiblingService.list(studentId, schoolId);
      ResponseBuilder.ok({ siblings: results }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const studentId = event.pathParameters?.id;
      if (!studentId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Student ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body = JSON.parse(event.body);
      const siblingStudentId = body.siblingStudentId;
      if (!siblingStudentId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'siblingStudentId is required', callback); return; }
      const results = await studentSiblingService.link(studentId, siblingStudentId, schoolId, userId(event));
      ResponseBuilder.ok({ siblings: results }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const studentId = event.pathParameters?.id;
      const siblingId = event.pathParameters?.siblingId;
      if (!studentId || !siblingId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Student ID and sibling ID are required', callback); return; }
      const ok = await studentSiblingService.unlink(studentId, siblingId, schoolId, userId(event));
      if (!ok) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Sibling link not found', callback); return; }
      ResponseBuilder.ok({ message: 'Sibling unlinked successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new StudentSiblingHandler();
export const list = guard(STUDENT_ACTIONS['student-sibling-handler.list'], handler.list);
export const create = guard(STUDENT_ACTIONS['student-sibling-handler.create'], handler.create);
export const remove = guard(STUDENT_ACTIONS['student-sibling-handler.remove'], handler.remove);
