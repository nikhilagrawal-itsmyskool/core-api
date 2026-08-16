import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { guard } from '../auth/authz';
import { TRANSPORT_ACTIONS } from './transport-actions';
import { transportAttendanceService } from './transport-attendance-service';
import { EditRecordRequest, OpenSessionRequest, SaveMarksRequest } from './transport-interfaces';

class TransportAttendanceHandler {
  // GET /attendance/roster?routeId=&date=
  public getRoster = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      if (!q.routeId || !q.date) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'routeId and date are required', callback);
        return;
      }
      const result = await transportAttendanceService.getRoster(ctx.schoolId, q.routeId, q.date);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /attendance/sessions — create/open a session for route+date (idempotent).
  public openSession = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<OpenSessionRequest>(event, callback);
      if (!body) return;
      if (!body.routeId || !body.academicYearId || !body.date) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'routeId, academicYearId and date are required', callback);
        return;
      }
      const session = await transportAttendanceService.openSession(ctx.schoolId, body.routeId, body.academicYearId, body.date, ctx.userId);
      ResponseBuilder.ok(session, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /attendance/sessions/{id}/marks
  public saveMarks = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<SaveMarksRequest>(event, callback);
      if (!body) return;
      if (!Array.isArray(body.marks)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'marks array is required', callback);
        return;
      }
      const result = await transportAttendanceService.saveMarks(ctx.schoolId, id, body.marks, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Session not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /attendance/sessions/{id}/finalize
  public finalize = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const result = await transportAttendanceService.finalize(ctx.schoolId, id, ctx.schoolCode, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Session not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /attendance/sessions/{id}
  public getSession = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const result = await transportAttendanceService.getSessionDetail(ctx.schoolId, id);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Session not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /attendance/sessions?routeId=&academicYearId=&from=&to=
  public listSessions = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      const sessions = await transportAttendanceService.listSessions(ctx.schoolId, {
        routeId: q.routeId, academicYearId: q.academicYearId, from: q.from, to: q.to,
      });
      ResponseBuilder.ok({ sessions }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /attendance/records/{id}
  public editRecord = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<EditRecordRequest>(event, callback);
      if (!body) return;
      const result = await transportAttendanceService.editRecord(ctx.schoolId, id, body, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Record not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new TransportAttendanceHandler();
export const getRoster = guard(TRANSPORT_ACTIONS['transport-attendance-handler.getRoster'], handler.getRoster);
export const openSession = guard(TRANSPORT_ACTIONS['transport-attendance-handler.openSession'], handler.openSession);
export const saveMarks = guard(TRANSPORT_ACTIONS['transport-attendance-handler.saveMarks'], handler.saveMarks);
export const finalize = guard(TRANSPORT_ACTIONS['transport-attendance-handler.finalize'], handler.finalize);
export const getSession = guard(TRANSPORT_ACTIONS['transport-attendance-handler.getSession'], handler.getSession);
export const listSessions = guard(TRANSPORT_ACTIONS['transport-attendance-handler.listSessions'], handler.listSessions);
export const editRecord = guard(TRANSPORT_ACTIONS['transport-attendance-handler.editRecord'], handler.editRecord);
