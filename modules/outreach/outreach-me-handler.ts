import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveEmployee, guardActiveStudent, parseBody, requireParam } from "./handler-util";
import { getCurrentAcademicYearId, getSchoolCodeById } from "./outreach-common";
import { outreachService } from "./outreach-service";
import { notifyMomentPublished } from "./outreach-notify";
import { guard } from "../auth/authz";
import { OUTREACH_ACTIONS } from "./outreach-actions";
import {
  TeacherCreateMomentRequest,
  AddPhotoRequest,
  SetReactionRequest,
} from "./outreach-interfaces";

// Teacher PWA (resolveEmployee; own-class posting via canPostForClass + own-authored scope)
// and the parent/student app feed (guardActiveStudent; published + audience-matched only).
class OutreachMeHandler {
  private forbidden(callback: ApiCallback): void {
    ResponseBuilder.forbidden(ErrorCode.MissingPermission, "You can only manage your own class's moments", callback);
  }

  // Resolve a moment the teacher authored, else write 404/403 and return null.
  private async requireOwnMoment(schoolId: string, employeeId: string, id: string, callback: ApiCallback): Promise<boolean> {
    const author = await outreachService.momentAuthor(schoolId, id);
    if (author === null) { ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback); return false; }
    if (author !== employeeId) { this.forbidden(callback); return false; }
    return true;
  }

  // ── Teacher PWA ────────────────────────────────────────────────────────────────

  // GET /outreach/me/classes?academicYearId=
  public myClasses = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const q = event.queryStringParameters || {};
      const ay = q.academicYearId || (await getCurrentAcademicYearId(emp.schoolId));
      if (!ay) return ResponseBuilder.ok([], callback);
      const classes = await outreachService.myClasses(emp.schoolId, emp.employeeId, ay);
      ResponseBuilder.ok(classes, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /outreach/me/posted — moments this teacher authored.
  public posted = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const rows = await outreachService.authoredByTeacher(emp.schoolId, emp.employeeId);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/me/moments {classId, title?, body?} — audience is forced to the class.
  public createMoment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const body = parseBody<TeacherCreateMomentRequest>(event, callback);
      if (!body) return;
      if (!body.classId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "classId is required", callback);
      const ay = await getCurrentAcademicYearId(emp.schoolId);
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      if (!(await outreachService.canPostForClass(emp.schoolId, emp.employeeId, body.classId, ay))) return this.forbidden(callback);
      const result = await outreachService.createMoment(
        emp.schoolId,
        { title: body.title, body: body.body, audience: [{ scope: "class", refId: body.classId }] },
        emp.employeeId,
        emp.employeeId,
        ay,
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/me/moments/{id}/photos {image, caption?}
  public addPhoto = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      if (!(await this.requireOwnMoment(emp.schoolId, emp.employeeId, id, callback))) return;
      const body = parseBody<AddPhotoRequest>(event, callback);
      if (!body) return;
      const result = await outreachService.addPhoto(emp.schoolId, id, body, emp.employeeId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /outreach/me/moments/{id}/photos/{photoId}
  public removePhoto = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const photoId = requireParam(event, "photoId", callback);
      if (!photoId) return;
      if (!(await this.requireOwnMoment(emp.schoolId, emp.employeeId, id, callback))) return;
      const result = await outreachService.removePhoto(emp.schoolId, id, photoId, emp.employeeId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment or photo not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/me/moments/{id}/publish — publish + fan out the notification.
  public publish = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      if (!(await this.requireOwnMoment(emp.schoolId, emp.employeeId, id, callback))) return;
      const result = await outreachService.publish(emp.schoolId, id, emp.employeeId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      const schoolCode = await getSchoolCodeById(emp.schoolId);
      if (schoolCode) {
        const studentIds = await outreachService.resolveAudienceStudentIds(emp.schoolId, id);
        await notifyMomentPublished(schoolCode, studentIds, id, result);
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/me/moments/{id}/unpublish
  public unpublish = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      if (!(await this.requireOwnMoment(emp.schoolId, emp.employeeId, id, callback))) return;
      const result = await outreachService.unpublish(emp.schoolId, id, emp.employeeId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ── Parent / student app feed (published + audience-matched only) ──────────────

  // GET /outreach/me/feed?limit=&offset=&academicYearId=
  public feed = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const result = await outreachService.studentFeed(auth.token.school_id, auth.activeStudentId, q.academicYearId || null, {
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
        offset: q.offset ? parseInt(q.offset, 10) : undefined,
      });
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /outreach/me/feed/{id}
  public getFeedMoment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const q = event.queryStringParameters || {};
      const result = await outreachService.studentMoment(auth.token.school_id, auth.activeStudentId, id, q.academicYearId || null);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /outreach/me/feed/{id}/reaction {emoji?}  (null/empty clears)
  public setReaction = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const schoolId = auth.token.school_id;
      const q = event.queryStringParameters || {};
      const scope = await outreachService.resolveStudentScope(schoolId, auth.activeStudentId, q.academicYearId || null);
      if (!scope || !(await outreachService.studentCanSee(schoolId, id, scope.classId, scope.grade))) {
        return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      }
      const body = parseBody<SetReactionRequest>(event, callback);
      if (!body) return;
      const summary = await outreachService.setReaction(schoolId, id, "student", auth.activeStudentId, body.emoji ?? null);
      ResponseBuilder.ok(summary, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /outreach/me/feed/{id}/photos/{photoId}/image — base64 (fallback / local dev)
  public getFeedPhotoImage = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const photoId = requireParam(event, "photoId", callback);
      if (!photoId) return;
      const schoolId = auth.token.school_id;
      const q = event.queryStringParameters || {};
      const scope = await outreachService.resolveStudentScope(schoolId, auth.activeStudentId, q.academicYearId || null);
      if (!scope || !(await outreachService.studentCanSee(schoolId, id, scope.classId, scope.grade))) {
        return ResponseBuilder.notFound(ErrorCode.InvalidId, "Image not found", callback);
      }
      const img = await outreachService.getPhotoImage(schoolId, photoId);
      if (!img) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Image not found", callback);
      ResponseBuilder.ok(
        { mimeType: img.mimeType, fileName: img.fileName, dataUri: `data:${img.mimeType};base64,${img.data}` },
        callback,
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new OutreachMeHandler();
const g = (ref: string, fn: any) => guard(OUTREACH_ACTIONS[ref], fn);
// Teacher PWA — guarded by outreach.moment.post.
export const myClasses = g("outreach-me-handler.myClasses", h.myClasses);
export const posted = g("outreach-me-handler.posted", h.posted);
export const createMoment = g("outreach-me-handler.createMoment", h.createMoment);
export const addPhoto = g("outreach-me-handler.addPhoto", h.addPhoto);
export const removePhoto = g("outreach-me-handler.removePhoto", h.removePhoto);
export const publish = g("outreach-me-handler.publish", h.publish);
export const unpublish = g("outreach-me-handler.unpublish", h.unpublish);
// Parent/student app — self-authorizes via the student token (PUBLIC, not guarded).
export const feed = h.feed;
export const getFeedMoment = h.getFeedMoment;
export const setReaction = h.setReaction;
export const getFeedPhotoImage = h.getFeedPhotoImage;
