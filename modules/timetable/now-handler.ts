import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { TIMETABLE_ACTIONS } from "./timetable-actions";
import { resolveSchool } from "./handler-util";
import { nowService } from "./now-service";
import { guardActiveStudent } from "../auth/auth-utils";
import { resolveStudentEnrollment } from "../../shared/lib/student-context";

class NowHandler {
  // GET /timetable/now?classId=&at=  — what a class is doing at the given moment
  // (school-local). `at` is an optional ISO instant (defaults to now); handy for
  // testing and for rendering "what's happening" at a chosen time.
  public now = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      if (!qp.classId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "classId is required", callback);
        return;
      }
      const result = await nowService.happeningNow(ctx.schoolId, qp.classId, qp.at);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Parent app — resolve the family's active child to its current class, then
  // serve "what's happening now" for that class. Active child from the family
  // token + X-Student-Id; schoolId from the token.
  public myNow = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const schoolId = auth.token.school_id;
      const enr = await resolveStudentEnrollment(schoolId, auth.activeStudentId);
      if (!enr || !enr.classId) {
        ResponseBuilder.ok({ now: null, next: null, note: "Student is not assigned to a class" }, callback);
        return;
      }
      const qp = event.queryStringParameters || {};
      const result = await nowService.happeningNow(schoolId, enr.classId, qp.at);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Parent app — the active child's full weekly published timetable.
  public myWeek = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const schoolId = auth.token.school_id;
      const enr = await resolveStudentEnrollment(schoolId, auth.activeStudentId);
      if (!enr || !enr.classId) {
        ResponseBuilder.ok({ classId: null, days: [], note: "Student is not assigned to a class" }, callback);
        return;
      }
      const qp = event.queryStringParameters || {};
      const result = await nowService.weekForClass(schoolId, enr.classId, qp.at);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /timetable/today?classId=&at= — today's full published day for a class
  // (all slots + which is now/next). Used by the admin student 360 view.
  public today = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      if (!qp.classId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "classId is required", callback);
        return;
      }
      const result = await nowService.dayForClass(ctx.schoolId, qp.classId, qp.at);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new NowHandler();
export const now = guard(TIMETABLE_ACTIONS['now-handler.now'], handler.now);
export const myNow = handler.myNow; // public/exempt
export const myWeek = handler.myWeek; // public/exempt
export const today = guard(TIMETABLE_ACTIONS['now-handler.today'], handler.today);
