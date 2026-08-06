import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool } from './handler-util';
import { syllabusOverviewService } from './syllabus-overview-service';

class SyllabusOverviewHandler {
  // GET /overview?academicYearId=&grade= — readiness board rows for a year.
  public overview = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      if (!qp.academicYearId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId is required', callback);
        return;
      }
      const rows = await syllabusOverviewService.getOverview(ctx.schoolId, qp.academicYearId, qp.grade);
      ResponseBuilder.ok({ rows }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SyllabusOverviewHandler();
export const overview = handler.overview;
