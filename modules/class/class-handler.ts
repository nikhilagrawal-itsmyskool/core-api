import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { classService } from './class-service';

class ClassHandler {
  public search = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await classService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const qp = event.queryStringParameters || {};
      const name = qp.name;
      const academicYearId = qp.academicYearId || qp.academic_year_id || undefined;
      // Ordinary dropdowns show only real classes (class.base_class_id is null), hiding
      // stream-child rows. includeCohort additionally surfaces timetable cohort/composite
      // classes (class_group_id set), which are otherwise timetable-internal.
      const includeCohort = qp.includeCohort === '1' || qp.includeCohort === 'true';

      const results = await classService.search(schoolId, name, academicYearId, includeCohort);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /classes/streams?baseClassId= — streams offered under a base class (empty if none).
  public streams = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;

    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await classService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const qp = event.queryStringParameters || {};
      const baseClassId = qp.baseClassId || qp.base_class_id;
      if (!baseClassId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'baseClassId is required', callback);
        return;
      }

      const results = await classService.getStreams(schoolId, baseClassId);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ClassHandler();
export const search = handler.search;
export const streams = handler.streams;
