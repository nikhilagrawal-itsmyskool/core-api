import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { feedbackService } from "./feedback-service";
import { RecordFeedbackRequest, CommentRequest, AssignRequest, ReviewRequest } from "./feedback-interfaces";
import { FEEDBACK_ACTIONS } from "./feedback-actions";

// Office / director surface (X-School-Code + JWT). Recording is open to teachers
// (feedback.record); the dashboard + all director actions are god-only (feedback.review).
// Actions here run with isReviewer=true (may act on any ticket; may assign without a
// comment). Role enforcement is applied by guard() at the export site below.
class FeedbackHandler {
  // GET /feedback/categories
  public listCategories = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      ResponseBuilder.ok(await feedbackService.listCategories(auth.schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /feedback  (record + first assignment; optional evidence attachments)
  public record = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<RecordFeedbackRequest>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await feedbackService.record(auth.schoolId, auth.userId, body), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /feedback?status=&assignedTo=&categoryId=&academicYearId=&owner=&sort=
  public list = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const rows = await feedbackService.listFeedback(auth.schoolId, {
        status: q.status || undefined,
        assignedTo: q.assignedTo || undefined,
        studentId: q.studentId || undefined,
        classId: q.classId || undefined,
        date: q.date || undefined,
        categoryId: q.categoryId || undefined,
        academicYearId: q.academicYearId || undefined,
        owner: q.owner || undefined,
        sort: q.sort || undefined,
        callerId: auth.userId,
      });
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /feedback/grouped?by=student|class|teacher|date&status=&academicYearId=
  public grouped = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const rows = await feedbackService.grouped(auth.schoolId, {
        by: q.by || "student",
        status: q.status || undefined,
        academicYearId: q.academicYearId || undefined,
      });
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /feedback/summary?academicYearId=
  public summary = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      ResponseBuilder.ok(await feedbackService.summary(auth.schoolId, q.academicYearId || undefined), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /feedback/{id}  (full ticket thread)
  public getById = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const item = await feedbackService.getThread(auth.schoolId, id, auth.userId);
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      ResponseBuilder.ok(item, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /feedback/{id}/comment   { body, mentions?, attachments? }
  public comment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<CommentRequest>(event, callback);
      if (!body) return;
      const item = await feedbackService.addComment(auth.schoolId, id, auth.userId, body, { isReviewer: true });
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      ResponseBuilder.ok(item, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /feedback/{id}/assign   { toEmployeeId, comment?, mentions?, attachments? }
  public assign = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<AssignRequest>(event, callback);
      if (!body) return;
      const item = await feedbackService.assign(auth.schoolId, id, auth.userId, body, { isReviewer: true });
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      ResponseBuilder.ok(item, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /feedback/{id}/complete   { note? }
  public complete = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = event.body ? parseBody<ReviewRequest>(event, callback) : { note: undefined };
      if (body === null) return;
      const item = await feedbackService.complete(auth.schoolId, id, auth.userId, body?.note);
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      ResponseBuilder.ok(item, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /feedback/{id}/cancel   { note? }
  public cancel = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = event.body ? parseBody<ReviewRequest>(event, callback) : { note: undefined };
      if (body === null) return;
      const item = await feedbackService.cancel(auth.schoolId, id, auth.userId, body?.note);
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      ResponseBuilder.ok(item, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /feedback/{id}/reopen   { note?, toEmployeeId? }
  public reopen = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = event.body ? parseBody<ReviewRequest>(event, callback) : {};
      if (body === null) return;
      const item = await feedbackService.reopen(auth.schoolId, id, auth.userId, body || {});
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      ResponseBuilder.ok(item, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /feedback/{id}/seen
  public seen = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      ResponseBuilder.ok(await feedbackService.markSeen(auth.schoolId, id, auth.userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /feedback/attachment/{fileId}
  public getAttachment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const fileId = requireParam(event, "fileId", callback);
      if (!fileId) return;
      const doc = await feedbackService.getAttachmentFile(auth.schoolId, fileId);
      if (!doc) return ResponseBuilder.notFound(ErrorCode.InvalidId, "File not found", callback);
      ResponseBuilder.ok({ mimeType: doc.mimeType, fileName: doc.fileName, dataUri: `data:${doc.mimeType};base64,${doc.data}` }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new FeedbackHandler();
export const listCategories = guard(FEEDBACK_ACTIONS["feedback-handler.listCategories"], h.listCategories);
export const record = guard(FEEDBACK_ACTIONS["feedback-handler.record"], h.record);
export const list = guard(FEEDBACK_ACTIONS["feedback-handler.list"], h.list);
export const grouped = guard(FEEDBACK_ACTIONS["feedback-handler.grouped"], h.grouped);
export const summary = guard(FEEDBACK_ACTIONS["feedback-handler.summary"], h.summary);
export const getById = guard(FEEDBACK_ACTIONS["feedback-handler.getById"], h.getById);
export const comment = guard(FEEDBACK_ACTIONS["feedback-handler.comment"], h.comment);
export const assign = guard(FEEDBACK_ACTIONS["feedback-handler.assign"], h.assign);
export const complete = guard(FEEDBACK_ACTIONS["feedback-handler.complete"], h.complete);
export const cancel = guard(FEEDBACK_ACTIONS["feedback-handler.cancel"], h.cancel);
export const reopen = guard(FEEDBACK_ACTIONS["feedback-handler.reopen"], h.reopen);
export const seen = guard(FEEDBACK_ACTIONS["feedback-handler.seen"], h.seen);
export const getAttachment = guard(FEEDBACK_ACTIONS["feedback-handler.getAttachment"], h.getAttachment);
