import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveEmployee, guardActiveStudent, parseBody, requireParam } from "./handler-util";
import { getCurrentAcademicYearId } from "./homework-common";
import { homeworkService } from "./homework-service";
import { AddItemRequest, EditItemRequest, EnsureDayRequest } from "./homework-interfaces";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Today's date in IST (school-local), so the student default matches the app's day.
function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Teacher PWA (resolveEmployee, scoped by canPostForClass) + student/parent app
// (guardActiveStudent, published homework only).
class HomeworkMeHandler {
  private forbidden(callback: ApiCallback): void {
    ResponseBuilder.forbidden(ErrorCode.MissingPermission, "You are not the class teacher for this class", callback);
  }

  // GET /homework/me/classes?academicYearId=
  public myClasses = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const q = event.queryStringParameters || {};
      const ay = q.academicYearId || (await getCurrentAcademicYearId(emp.schoolId));
      if (!ay) return ResponseBuilder.ok([], callback);
      const classes = await homeworkService.myHomeworkClasses(emp.schoolId, emp.employeeId, ay);
      ResponseBuilder.ok(classes, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /homework/me?classId=&date=&academicYearId=
  public getDay = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const q = event.queryStringParameters || {};
      if (!q.classId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "classId is required", callback);
      if (!q.date || !DATE_RE.test(q.date)) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "date (YYYY-MM-DD) is required", callback);
      const ay = q.academicYearId || (await getCurrentAcademicYearId(emp.schoolId));
      if (ay && !(await homeworkService.canPostForClass(emp.schoolId, emp.employeeId, q.classId, ay))) return this.forbidden(callback);
      const result = await homeworkService.getDay(emp.schoolId, q.classId, q.date, ay || undefined);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /homework/me/day {classId, date, academicYearId?}
  public ensureDay = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const body = parseBody<EnsureDayRequest>(event, callback);
      if (!body) return;
      if (!body.classId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "classId is required", callback);
      if (!body.date || !DATE_RE.test(body.date)) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "date (YYYY-MM-DD) is required", callback);
      const ay = body.academicYearId || (await getCurrentAcademicYearId(emp.schoolId));
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      if (!(await homeworkService.canPostForClass(emp.schoolId, emp.employeeId, body.classId, ay))) return this.forbidden(callback);
      await homeworkService.ensureDay(emp.schoolId, ay, body.classId, body.date, emp.employeeId);
      const result = await homeworkService.getDay(emp.schoolId, body.classId, body.date, ay);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /homework/me/items {classId, date, subjectLabel?, note?, image}
  public addItem = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const body = parseBody<AddItemRequest>(event, callback);
      if (!body) return;
      if (!body.classId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "classId is required", callback);
      if (!body.date || !DATE_RE.test(body.date)) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "date (YYYY-MM-DD) is required", callback);
      const ay = body.academicYearId || (await getCurrentAcademicYearId(emp.schoolId));
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      if (!(await homeworkService.canPostForClass(emp.schoolId, emp.employeeId, body.classId, ay))) return this.forbidden(callback);
      const result = await homeworkService.addItem(emp.schoolId, { ...body, academicYearId: ay }, emp.employeeId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /homework/me/items/{id} {subjectLabel?, note?}
  public editItem = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const scope = await homeworkService.itemScope(emp.schoolId, id);
      if (!scope) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Homework item not found", callback);
      if (!(await homeworkService.canPostForClass(emp.schoolId, emp.employeeId, scope.classId, scope.ay))) return this.forbidden(callback);
      const body = parseBody<EditItemRequest>(event, callback);
      if (!body) return;
      const result = await homeworkService.editItem(emp.schoolId, id, body, emp.employeeId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Homework item not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /homework/me/items/{id}
  public removeItem = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const scope = await homeworkService.itemScope(emp.schoolId, id);
      if (!scope) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Homework item not found", callback);
      if (!(await homeworkService.canPostForClass(emp.schoolId, emp.employeeId, scope.classId, scope.ay))) return this.forbidden(callback);
      const result = await homeworkService.removeItem(emp.schoolId, id, emp.employeeId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Homework item not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /homework/me/items/{id}/image
  public getItemImage = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const img = await homeworkService.getItemImage(emp.schoolId, id);
      if (!img) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Image not found", callback);
      ResponseBuilder.ok(
        { mimeType: img.mimeType, fileName: img.fileName, dataUri: `data:${img.mimeType};base64,${img.data}` },
        callback,
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  private async publishToggle(
    event: ApiEvent,
    callback: ApiCallback,
    action: "publish" | "unpublish",
  ): Promise<void> {
    const emp = resolveEmployee(event, callback);
    if (!emp) return;
    const id = requireParam(event, "id", callback);
    if (!id) return;
    const scope = await homeworkService.dayScope(emp.schoolId, id);
    if (!scope) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Homework not found", callback);
    if (!(await homeworkService.canPostForClass(emp.schoolId, emp.employeeId, scope.classId, scope.ay))) return this.forbidden(callback);
    const result =
      action === "publish"
        ? await homeworkService.publish(emp.schoolId, id, emp.employeeId)
        : await homeworkService.unpublish(emp.schoolId, id, emp.employeeId);
    if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Homework not found", callback);
    ResponseBuilder.ok(result, callback);
  }

  // POST /homework/me/day/{id}/publish
  public publish = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      await this.publishToggle(event, callback, "publish");
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /homework/me/day/{id}/unpublish
  public unpublish = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      await this.publishToggle(event, callback, "unpublish");
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /homework/me/today?date=  (student/parent app)
  public studentToday = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const date = q.date && DATE_RE.test(q.date) ? q.date : istToday();
      const result = await homeworkService.studentToday(auth.token.school_id, auth.activeStudentId, date, q.academicYearId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new HomeworkMeHandler();
export const myClasses = h.myClasses;
export const getDay = h.getDay;
export const ensureDay = h.ensureDay;
export const addItem = h.addItem;
export const editItem = h.editItem;
export const removeItem = h.removeItem;
export const getItemImage = h.getItemImage;
export const publish = h.publish;
export const unpublish = h.unpublish;
export const studentToday = h.studentToday;
