import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { studentService } from './student-service';
import { studentGuardianService } from './student-guardian-service';
import { CreateGuardianRequest, UpdateGuardianRequest } from './student-interfaces';
import { guard } from '../auth/authz';
import { STUDENT_ACTIONS } from './student-actions';

function userId(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

class StudentGuardianHandler {
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

      const results = await studentGuardianService.list(studentId, schoolId);
      ResponseBuilder.ok({ guardians: results }, callback);
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

      const body: CreateGuardianRequest = JSON.parse(event.body);
      const result = await studentGuardianService.create(studentId, body, schoolId, userId(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const guardianId = event.pathParameters?.guardianId;
      if (!guardianId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Guardian ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: UpdateGuardianRequest = JSON.parse(event.body);
      const result = await studentGuardianService.update(guardianId, body, schoolId, userId(event));
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Guardian not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const guardianId = event.pathParameters?.guardianId;
      if (!guardianId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Guardian ID is required', callback); return; }

      const ok = await studentGuardianService.delete(guardianId, schoolId, userId(event));
      if (!ok) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Guardian not found', callback); return; }
      ResponseBuilder.ok({ message: 'Guardian deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new StudentGuardianHandler();
export const list = guard(STUDENT_ACTIONS['student-guardian-handler.list'], handler.list);
export const create = guard(STUDENT_ACTIONS['student-guardian-handler.create'], handler.create);
export const update = guard(STUDENT_ACTIONS['student-guardian-handler.update'], handler.update);
export const remove = guard(STUDENT_ACTIONS['student-guardian-handler.remove'], handler.remove);
