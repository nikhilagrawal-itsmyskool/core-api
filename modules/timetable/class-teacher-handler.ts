import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { classTeacherService } from "./class-teacher-service";
import { timetableService } from "./timetable-service";
import {
  CreateClassTeacherRequest,
  UpdateClassTeacherRequest,
} from "./timetable-interfaces";

// firstPeriodDays (optional): weekdays 1=Mon..7=Sun the class teacher takes the 1st
// period. null = all teaching days; [] = none. Returns an error message or null.
function validateFirstPeriodDays(days: unknown): string | null {
  if (days === undefined || days === null) return null;
  if (!Array.isArray(days))
    return "firstPeriodDays must be an array of weekday numbers (1=Mon..7=Sun)";
  for (const d of days) {
    if (!Number.isInteger(d) || (d as number) < 1 || (d as number) > 7) {
      return "firstPeriodDays must contain integers between 1 (Mon) and 7 (Sun)";
    }
  }
  return null;
}

class ClassTeacherHandler {
  public list = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      const classTeachers = await classTeacherService.list(
        ctx.schoolId,
        qp.classId,
        qp.academicYearId,
      );
      ResponseBuilder.ok({ classTeachers }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await classTeacherService.getById(id, ctx.schoolId);
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Class teacher not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateClassTeacherRequest>(event, callback);
      if (!body) return;
      if (!body.academicYearId || !body.classId || !body.teacherId) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "academicYearId, classId and teacherId are required",
          callback,
        );
        return;
      }
      if (!(await timetableService.classExists(body.classId, ctx.schoolId))) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "Invalid classId",
          callback,
        );
        return;
      }
      if (
        body.firstPeriodSubjectId &&
        !(await timetableService.subjectExists(
          body.firstPeriodSubjectId,
          ctx.schoolId,
        ))
      ) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "Invalid firstPeriodSubjectId",
          callback,
        );
        return;
      }
      const daysErr = validateFirstPeriodDays(body.firstPeriodDays);
      if (daysErr) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, daysErr, callback);
        return;
      }
      const result = await classTeacherService.create(
        body,
        ctx.schoolId,
        ctx.userId,
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<UpdateClassTeacherRequest>(event, callback);
      if (!body) return;
      if (
        body.firstPeriodSubjectId &&
        !(await timetableService.subjectExists(
          body.firstPeriodSubjectId,
          ctx.schoolId,
        ))
      ) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "Invalid firstPeriodSubjectId",
          callback,
        );
        return;
      }
      const daysErr = validateFirstPeriodDays(body.firstPeriodDays);
      if (daysErr) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, daysErr, callback);
        return;
      }
      const result = await classTeacherService.update(
        id,
        body,
        ctx.schoolId,
        ctx.userId,
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Class teacher not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const existing = await classTeacherService.getById(id, ctx.schoolId);
      if (!existing) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Class teacher not found",
          callback,
        );
        return;
      }
      await classTeacherService.delete(id, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(
        { message: "Class teacher deleted successfully" },
        callback,
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ClassTeacherHandler();
export const list = handler.list;
export const getById = handler.getById;
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
