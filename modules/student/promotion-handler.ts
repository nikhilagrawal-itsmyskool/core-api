import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { studentService } from './student-service';
import { promotionService } from './promotion-service';
import { PromoteRequest, PromoteClassRequest, GraduateRequest, MoveSectionRequest } from './student-interfaces';
import { guard } from '../auth/authz';
import { STUDENT_ACTIONS } from './student-actions';

function userId(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

class PromotionHandler {
  private async resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await studentService.getSchoolIdByCode(schoolCode);
    if (!schoolId) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
      return null;
    }
    return schoolId;
  }

  // POST /promote  (also used for Retain — toClassId === current class)
  public promote = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: PromoteRequest = JSON.parse(event.body);
      const result = await promotionService.promote(body, schoolId, userId(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /promote-class
  public promoteClass = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: PromoteClassRequest = JSON.parse(event.body);
      const result = await promotionService.promoteClass(body, schoolId, userId(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /graduate
  public graduate = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: GraduateRequest = JSON.parse(event.body);
      const result = await promotionService.graduate(body, schoolId, userId(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /move-section?studentId=  — current enrolment + same-grade target sections
  public moveOptions = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const studentId = event.queryStringParameters?.studentId;
      if (!studentId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'studentId is required', callback); return; }
      const result = await promotionService.moveOptions(studentId, schoolId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /move-section  — move one student to another section of the same grade
  public moveSection = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body: MoveSectionRequest = JSON.parse(event.body);
      const result = await promotionService.moveSection(body, schoolId, userId(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new PromotionHandler();
export const promote = guard(STUDENT_ACTIONS['promotion-handler.promote'], handler.promote);
export const promoteClass = guard(STUDENT_ACTIONS['promotion-handler.promoteClass'], handler.promoteClass);
export const graduate = guard(STUDENT_ACTIONS['promotion-handler.graduate'], handler.graduate);
export const moveOptions = guard(STUDENT_ACTIONS['promotion-handler.moveOptions'], handler.moveOptions);
export const moveSection = guard(STUDENT_ACTIONS['promotion-handler.moveSection'], handler.moveSection);
