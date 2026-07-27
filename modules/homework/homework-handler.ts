import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { getCurrentAcademicYearId } from "./homework-common";
import { homeworkService } from "./homework-service";
import {
  AddItemRequest,
  EditItemRequest,
  EnsureDayRequest,
  SetClassTeacherRequest,
} from "./homework-interfaces";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badDate(callback: ApiCallback): void {
  ResponseBuilder.badRequest(ErrorCode.InvalidInput, "date (YYYY-MM-DD) is required", callback);
}

// Admin/teacher surface (X-School-Code + JWT). Class-teacher scope is enforced on
// the teacher PWA (/me) surface; the admin surface can act on any class.
class HomeworkHandler {
  // GET /homework?classId=&date=&academicYearId=
  public getDay = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      if (!q.classId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "classId is required", callback);
      if (!q.date || !DATE_RE.test(q.date)) return badDate(callback);
      const result = await homeworkService.getDay(auth.schoolId, q.classId, q.date, q.academicYearId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /homework/day {classId, date, academicYearId?}
  public ensureDay = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<EnsureDayRequest>(event, callback);
      if (!body) return;
      if (!body.classId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "classId is required", callback);
      if (!body.date || !DATE_RE.test(body.date)) return badDate(callback);
      const ay = body.academicYearId || (await getCurrentAcademicYearId(auth.schoolId));
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      await homeworkService.ensureDay(auth.schoolId, ay, body.classId, body.date, auth.userId);
      const result = await homeworkService.getDay(auth.schoolId, body.classId, body.date, ay);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /homework/items {classId, date, subjectLabel?, note?, image}
  public addItem = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<AddItemRequest>(event, callback);
      if (!body) return;
      if (!body.classId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "classId is required", callback);
      if (!body.date || !DATE_RE.test(body.date)) return badDate(callback);
      const result = await homeworkService.addItem(auth.schoolId, body, auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /homework/items/{id} {subjectLabel?, note?}
  public editItem = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<EditItemRequest>(event, callback);
      if (!body) return;
      const result = await homeworkService.editItem(auth.schoolId, id, body, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Homework item not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /homework/items/{id}
  public removeItem = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await homeworkService.removeItem(auth.schoolId, id, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Homework item not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /homework/items/{id}/image — raw base64 (fallback / local dev)
  public getItemImage = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const img = await homeworkService.getItemImage(auth.schoolId, id);
      if (!img) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Image not found", callback);
      ResponseBuilder.ok(
        { mimeType: img.mimeType, fileName: img.fileName, dataUri: `data:${img.mimeType};base64,${img.data}` },
        callback,
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /homework/day/{id}/publish
  public publish = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await homeworkService.publish(auth.schoolId, id, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Homework not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /homework/day/{id}/unpublish
  public unpublish = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await homeworkService.unpublish(auth.schoolId, id, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Homework not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /homework/classes?academicYearId= — classes homework can be posted for
  // (non-streamed base classes + stream-child classes of streamed sections).
  public listClasses = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const ay = q.academicYearId || (await getCurrentAcademicYearId(auth.schoolId));
      if (!ay) return ResponseBuilder.ok([], callback);
      const rows = await homeworkService.listPostableClasses(auth.schoolId, ay);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /homework/class-teachers?academicYearId=
  public classTeacherMap = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const ay = q.academicYearId || (await getCurrentAcademicYearId(auth.schoolId));
      if (!ay) return ResponseBuilder.ok([], callback);
      const rows = await homeworkService.classTeacherMap(auth.schoolId, ay);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /homework/class-teachers/{classId} {teacherId, academicYearId?}
  public setClassTeacher = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const body = parseBody<SetClassTeacherRequest>(event, callback);
      if (!body) return;
      if (!body.teacherId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "teacherId is required", callback);
      const ay = body.academicYearId || (await getCurrentAcademicYearId(auth.schoolId));
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      await homeworkService.setClassTeacherOverride(auth.schoolId, ay, classId, body.teacherId, auth.userId);
      const rows = await homeworkService.classTeacherMap(auth.schoolId, ay);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /homework/class-teachers/{classId}?academicYearId=
  public clearClassTeacher = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const q = event.queryStringParameters || {};
      const ay = q.academicYearId || (await getCurrentAcademicYearId(auth.schoolId));
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      await homeworkService.clearClassTeacherOverride(auth.schoolId, ay, classId, auth.userId);
      const rows = await homeworkService.classTeacherMap(auth.schoolId, ay);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /homework/audit?classId=&date=
  public getAudit = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      if (!q.classId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "classId is required", callback);
      if (!q.date || !DATE_RE.test(q.date)) return badDate(callback);
      const rows = await homeworkService.getAudit(auth.schoolId, q.classId, q.date);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new HomeworkHandler();
export const getDay = h.getDay;
export const ensureDay = h.ensureDay;
export const addItem = h.addItem;
export const editItem = h.editItem;
export const removeItem = h.removeItem;
export const getItemImage = h.getItemImage;
export const publish = h.publish;
export const unpublish = h.unpublish;
export const listClasses = h.listClasses;
export const classTeacherMap = h.classTeacherMap;
export const setClassTeacher = h.setClassTeacher;
export const clearClassTeacher = h.clearClassTeacher;
export const getAudit = h.getAudit;
