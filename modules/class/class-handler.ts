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
      // Cohort/composite classes (class.class_group_id set) are timetable-internal
      // and hidden from ordinary dropdowns unless explicitly requested.
      const includeCohort = qp.includeCohort === '1' || qp.includeCohort === 'true';

      const results = await classService.search(schoolId, name, academicYearId, includeCohort);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ClassHandler();
export const search = handler.search;
