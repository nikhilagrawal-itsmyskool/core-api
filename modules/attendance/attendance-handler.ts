import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { resolveDayFlags } from './attendance-util';
import { guard } from '../auth/authz';
import { ATTENDANCE_ACTIONS } from './attendance-actions';
import { attendanceService } from './attendance-service';
import { OpenSessionRequest, SaveMarksRequest, EditRecordRequest } from './attendance-interfaces';

class AttendanceHandler {
  // GET /roster?classId=&academicYearId=&date=
  public getRoster = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      if (!q.classId || !q.academicYearId || !q.date) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'classId, academicYearId and date are required', callback);
        return;
      }
      const result = await attendanceService.getRoster(ctx.schoolId, q.classId, q.academicYearId, q.date);
      const dayInfo = await resolveDayFlags(ctx.schoolId, q.academicYearId, q.date);
      ResponseBuilder.ok({ ...result, dayInfo }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /sessions — create/open a session for class+date (idempotent).
  public openSession = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<OpenSessionRequest>(event, callback);
      if (!body) return;
      if (!body.classId || !body.academicYearId || !body.date) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'classId, academicYearId and date are required', callback);
        return;
      }
      const session = await attendanceService.openSession(ctx.schoolId, body.classId, body.academicYearId, body.date, ctx.userId);
      const dayInfo = await resolveDayFlags(ctx.schoolId, body.academicYearId, body.date);
      ResponseBuilder.ok({ ...session, dayInfo }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /sessions/{id}/marks
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
      const result = await attendanceService.saveMarks(ctx.schoolId, id, body.marks, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Session not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /sessions/{id}/finalize
  public finalize = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const result = await attendanceService.finalize(ctx.schoolId, id, ctx.schoolCode, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Session not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /sessions/{id}
  public getSession = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const result = await attendanceService.getSessionDetail(ctx.schoolId, id);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Session not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /sessions?classId=&academicYearId=&from=&to=
  public listSessions = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      const sessions = await attendanceService.listSessions(ctx.schoolId, {
        classId: q.classId, academicYearId: q.academicYearId, from: q.from, to: q.to,
      });
      ResponseBuilder.ok({ sessions }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /records/{id} — edit a single record (back-dated/finalized correction).
  public editRecord = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<EditRecordRequest>(event, callback);
      if (!body) return;
      const result = await attendanceService.editRecord(ctx.schoolId, id, body, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Record not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /student/{studentId}?academicYearId=&from=&to= — a student's attendance
  // (daily records + summary) for the 360 view.
  public getStudentAttendance = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const studentId = requireParam(event, 'studentId', callback);
      if (!studentId) return;
      const q = event.queryStringParameters || {};
      const result = await attendanceService.getStudentAttendance(ctx.schoolId, studentId, {
        academicYearId: q.academicYearId, from: q.from, to: q.to,
      });
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /register?classId=&academicYearId=&from=&to= — class attendance register.
  public getRegister = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      if (!q.classId || !q.academicYearId || !q.from || !q.to) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'classId, academicYearId, from and to are required', callback);
        return;
      }
      const result = await attendanceService.getClassRegister(ctx.schoolId, q.classId, q.academicYearId, q.from, q.to);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new AttendanceHandler();
export const getStudentAttendance = guard(ATTENDANCE_ACTIONS['attendance-handler.getStudentAttendance'], handler.getStudentAttendance);
export const getRegister = guard(ATTENDANCE_ACTIONS['attendance-handler.getRegister'], handler.getRegister);
export const getRoster = guard(ATTENDANCE_ACTIONS['attendance-handler.getRoster'], handler.getRoster);
export const openSession = guard(ATTENDANCE_ACTIONS['attendance-handler.openSession'], handler.openSession);
export const saveMarks = guard(ATTENDANCE_ACTIONS['attendance-handler.saveMarks'], handler.saveMarks);
export const finalize = guard(ATTENDANCE_ACTIONS['attendance-handler.finalize'], handler.finalize);
export const getSession = guard(ATTENDANCE_ACTIONS['attendance-handler.getSession'], handler.getSession);
export const listSessions = guard(ATTENDANCE_ACTIONS['attendance-handler.listSessions'], handler.listSessions);
export const editRecord = guard(ATTENDANCE_ACTIONS['attendance-handler.editRecord'], handler.editRecord);
