import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { feedbackService } from "./feedback-service";
import { RecordFeedbackRequest, ReviewRequest } from "./feedback-interfaces";
import { FEEDBACK_ACTIONS } from "./feedback-actions";

// Office / director surface (X-School-Code + JWT). Recording is open to teachers
// (feedback.record); the dashboard/review actions are god-only (feedback.review). Role
// enforcement is applied by guard() at the export site below.
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

  // POST /feedback  (record + assign to a teacher)
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

  // GET /feedback?status=&assignedTo=&categoryId=&academicYearId=&sort=oldest
  public list = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const rows = await feedbackService.listFeedback(auth.schoolId, {
        status: q.status || undefined,
        assignedTo: q.assignedTo || undefined,
        categoryId: q.categoryId || undefined,
        academicYearId: q.academicYearId || undefined,
        sort: q.sort || undefined,
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

  // GET /feedback/{id}  (detail + audit trail)
  public getById = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const item = await feedbackService.getFeedback(auth.schoolId, id);
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      const audit = await feedbackService.getAudit(auth.schoolId, id);
      ResponseBuilder.ok({ ...item, audit }, callback);
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

  // POST /feedback/{id}/reopen   { note? }
  public reopen = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = event.body ? parseBody<ReviewRequest>(event, callback) : { note: undefined };
      if (body === null) return;
      const item = await feedbackService.reopen(auth.schoolId, id, auth.userId, body?.note);
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      ResponseBuilder.ok(item, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new FeedbackHandler();
export const listCategories = guard(FEEDBACK_ACTIONS["feedback-handler.listCategories"], h.listCategories);
export const record = guard(FEEDBACK_ACTIONS["feedback-handler.record"], h.record);
export const list = guard(FEEDBACK_ACTIONS["feedback-handler.list"], h.list);
export const summary = guard(FEEDBACK_ACTIONS["feedback-handler.summary"], h.summary);
export const getById = guard(FEEDBACK_ACTIONS["feedback-handler.getById"], h.getById);
export const complete = guard(FEEDBACK_ACTIONS["feedback-handler.complete"], h.complete);
export const reopen = guard(FEEDBACK_ACTIONS["feedback-handler.reopen"], h.reopen);
