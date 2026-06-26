import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { studentService } from './student-service';
import { studentAdminService } from './student-admin-service';
import { CreateStudentRequest, UpdateStudentRequest } from './student-interfaces';

function userId(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

class StudentAdminHandler {
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

      const q = event.queryStringParameters || {};
      const results = await studentService.search(schoolId, {
        name: q.name,
        classId: q.classId,
        academicYearId: q.academicYearId,
        admissionNumber: q.admissionNumber,
        phone: q.phone,
      });
      ResponseBuilder.ok({ students: results }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Student ID is required', callback); return; }

      const result = await studentAdminService.getDetail(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Student not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;

      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: CreateStudentRequest = JSON.parse(event.body);

      const result = await studentAdminService.create(body, schoolId, userId(event));
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

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Student ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body: UpdateStudentRequest = JSON.parse(event.body);
      const result = await studentAdminService.update(id, body, schoolId, userId(event));
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Student not found', callback); return; }
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

      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Student ID is required', callback); return; }

      const ok = await studentAdminService.delete(id, schoolId, userId(event));
      if (!ok) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Student not found', callback); return; }
      ResponseBuilder.ok({ message: 'Student deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new StudentAdminHandler();
export const list = handler.list;
export const getById = handler.getById;
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
