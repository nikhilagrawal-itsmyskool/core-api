import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { studentService } from './student-service';
import { houseService } from './house-service';
import { CreateHouseRequest, UpdateHouseRequest, SetHouseTeachersRequest } from './student-interfaces';
import { guard } from '../auth/authz';
import { STUDENT_ACTIONS } from './student-actions';

function userId(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

class HouseHandler {
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
      const results = await houseService.list(schoolId);
      ResponseBuilder.ok({ houses: results }, callback);
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
      const body: CreateHouseRequest = JSON.parse(event.body);
      const result = await houseService.create(body, schoolId, userId(event));
      ResponseBuilder.ok(result, callback);
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'House ID is required', callback); return; }
      const result = await houseService.getById(id, schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'House not found', callback); return; }
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'House ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: UpdateHouseRequest = JSON.parse(event.body);
      const result = await houseService.update(id, body, schoolId, userId(event));
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'House not found', callback); return; }
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
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'House ID is required', callback); return; }
      const ok = await houseService.delete(id, schoolId, userId(event));
      if (!ok) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'House not found', callback); return; }
      ResponseBuilder.ok({ message: 'House deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /houses/{id}/teachers
  public listTeachers = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'House ID is required', callback); return; }
      const result = await houseService.listTeachers(id, schoolId);
      ResponseBuilder.ok({ teachers: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /houses/{id}/teachers  body { teachers: [{ employeeId, role }] }
  public setTeachers = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'House ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: SetHouseTeachersRequest = JSON.parse(event.body);
      const result = await houseService.setTeachers(id, body.teachers, schoolId, userId(event));
      ResponseBuilder.ok({ teachers: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /students/{id}/house  body { houseId: string | null }
  public assign = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const studentId = event.pathParameters?.id;
      if (!studentId) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Student ID is required', callback); return; }
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }

      const body = JSON.parse(event.body) as { houseId: string | null };
      const ok = await houseService.assignToStudent(studentId, body.houseId ?? null, schoolId, userId(event));
      if (!ok) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Student not found', callback); return; }
      ResponseBuilder.ok({ message: 'House assigned' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new HouseHandler();
export const list = guard(STUDENT_ACTIONS['house-handler.list'], handler.list);
export const create = guard(STUDENT_ACTIONS['house-handler.create'], handler.create);
export const getById = guard(STUDENT_ACTIONS['house-handler.getById'], handler.getById);
export const update = guard(STUDENT_ACTIONS['house-handler.update'], handler.update);
export const remove = guard(STUDENT_ACTIONS['house-handler.remove'], handler.remove);
export const listTeachers = guard(STUDENT_ACTIONS['house-handler.listTeachers'], handler.listTeachers);
export const setTeachers = guard(STUDENT_ACTIONS['house-handler.setTeachers'], handler.setTeachers);
export const assign = guard(STUDENT_ACTIONS['house-handler.assign'], handler.assign);
