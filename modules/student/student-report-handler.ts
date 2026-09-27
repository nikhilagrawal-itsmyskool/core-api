import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader, getCallerContext } from '../auth/auth-utils';
import { maskContactFields } from '../../shared/util/mask-phone';
import { studentService } from './student-service';
import { studentReportService, REPORT_CONTACT_FIELDS, ReportRequest } from './student-report-service';
import { guard } from '../auth/authz';
import { STUDENT_ACTIONS } from './student-actions';

function userId(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

class StudentReportHandler {
  private async resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await studentService.getSchoolIdByCode(schoolCode);
    if (!schoolId) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
      return null;
    }
    return schoolId;
  }

  // GET /reports/fields — the column catalogue for the report builder.
  public fields = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      ResponseBuilder.ok({ fields: studentReportService.catalog() }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /reports/roster — { academicYearId, classIds[], fields[], filter? }.
  // Reveals unmasked contacts to admin/god only (same rule as the bulk-class roster).
  public roster = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body = JSON.parse(event.body) as ReportRequest;
      const result = await studentReportService.roster(schoolId, body);

      const reveal = getCallerContext(event).canRevealContacts;
      const contactCols = REPORT_CONTACT_FIELDS.filter((k) => (body.fields || []).includes(k));
      if (contactCols.length) {
        (result.rows as any[]).forEach((r) => maskContactFields(r, contactCols, reveal));
      }

      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /reports/saved — school-wide saved report templates.
  public listSaved = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const saved = await studentReportService.listSaved(schoolId);
      ResponseBuilder.ok({ saved }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /reports/saved — { name, config: { fields, filter, orientation, pageBreak } }.
  public saveReport = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback); return; }
      const body = JSON.parse(event.body);
      const saved = await studentReportService.saveReport(schoolId, body.name, body.config, userId(event));
      ResponseBuilder.ok(saved, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /reports/saved/{id}
  public deleteSaved = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) { ResponseBuilder.badRequest(ErrorCode.MissingId, 'Report ID is required', callback); return; }
      const ok = await studentReportService.deleteSaved(schoolId, id, userId(event));
      if (!ok) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Saved report not found', callback); return; }
      ResponseBuilder.ok({ message: 'Saved report deleted' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new StudentReportHandler();
export const fields = guard(STUDENT_ACTIONS['student-report-handler.fields'], handler.fields);
export const roster = guard(STUDENT_ACTIONS['student-report-handler.roster'], handler.roster);
export const listSaved = guard(STUDENT_ACTIONS['student-report-handler.listSaved'], handler.listSaved);
export const saveReport = guard(STUDENT_ACTIONS['student-report-handler.saveReport'], handler.saveReport);
export const deleteSaved = guard(STUDENT_ACTIONS['student-report-handler.deleteSaved'], handler.deleteSaved);
