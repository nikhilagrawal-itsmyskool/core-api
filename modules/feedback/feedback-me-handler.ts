import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { resolveEmployee, parseBody, requireParam } from "./handler-util";
import { feedbackService } from "./feedback-service";
import { CommentRequest, AssignRequest } from "./feedback-interfaces";
import { FEEDBACK_ACTIONS } from "./feedback-actions";

// Teacher PWA surface (employee bearer token). A teacher sees tickets they participate in
// (own / watch / recorded) and can comment or reassign (forward / send back). Reassign is
// owner-only and comment-mandatory (enforced in the service, isReviewer=false). Completing /
// cancelling / reopening is the director's (feedback.review) job, not exposed here.
class FeedbackMeHandler {
  // GET /feedback/me?tab=act|watching|recorded&status=
  public list = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const q = event.queryStringParameters || {};
      const rows = await feedbackService.listForEmployee(emp.schoolId, emp.employeeId, q.tab || "act", q.status || undefined);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /feedback/me/{id}  (full ticket thread; participants only)
  public getById = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      if (!(await feedbackService.isParticipant(emp.schoolId, id, emp.employeeId))) {
        return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      }
      const item = await feedbackService.getThread(emp.schoolId, id, emp.employeeId);
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      ResponseBuilder.ok(item, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /feedback/me/{id}/comment   { body, mentions?, attachments? }
  public comment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<CommentRequest>(event, callback);
      if (!body) return;
      const item = await feedbackService.addComment(emp.schoolId, id, emp.employeeId, body, { isReviewer: false });
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      ResponseBuilder.ok(item, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /feedback/me/{id}/assign   { toEmployeeId, comment, mentions?, attachments? }
  public assign = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<AssignRequest>(event, callback);
      if (!body) return;
      const item = await feedbackService.assign(emp.schoolId, id, emp.employeeId, body, { isReviewer: false });
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      ResponseBuilder.ok(item, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /feedback/me/{id}/seen
  public seen = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      ResponseBuilder.ok(await feedbackService.markSeen(emp.schoolId, id, emp.employeeId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /feedback/me/attachment/{fileId}
  public getAttachment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const fileId = requireParam(event, "fileId", callback);
      if (!fileId) return;
      const doc = await feedbackService.getAttachmentForParticipant(emp.schoolId, fileId, emp.employeeId);
      if (!doc) return ResponseBuilder.notFound(ErrorCode.InvalidId, "File not found", callback);
      ResponseBuilder.ok({ mimeType: doc.mimeType, fileName: doc.fileName, dataUri: `data:${doc.mimeType};base64,${doc.data}` }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new FeedbackMeHandler();
export const list = guard(FEEDBACK_ACTIONS["feedback-me-handler.list"], h.list);
export const getById = guard(FEEDBACK_ACTIONS["feedback-me-handler.getById"], h.getById);
export const comment = guard(FEEDBACK_ACTIONS["feedback-me-handler.comment"], h.comment);
export const assign = guard(FEEDBACK_ACTIONS["feedback-me-handler.assign"], h.assign);
export const seen = guard(FEEDBACK_ACTIONS["feedback-me-handler.seen"], h.seen);
export const getAttachment = guard(FEEDBACK_ACTIONS["feedback-me-handler.getAttachment"], h.getAttachment);
