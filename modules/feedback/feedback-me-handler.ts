import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { resolveEmployee, parseBody, requireParam } from "./handler-util";
import { feedbackService } from "./feedback-service";
import { RespondRequest } from "./feedback-interfaces";
import { FEEDBACK_ACTIONS } from "./feedback-actions";

// Teacher PWA surface (employee bearer token). Every action is scoped to the logged-in
// teacher: they see only feedback assigned to them and can respond only on their own.
class FeedbackMeHandler {
  // GET /feedback/me?status=  (feedback assigned to me; status defaults to "open")
  public list = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const q = event.queryStringParameters || {};
      const rows = await feedbackService.listFeedback(emp.schoolId, {
        assignedTo: emp.employeeId,
        status: q.status || undefined,
        sort: q.sort || undefined,
      });
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /feedback/me/{id}  (one of my feedbacks + its audit trail)
  public getById = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const item = await feedbackService.getFeedback(emp.schoolId, id);
      if (!item || item.assignedTo !== emp.employeeId) {
        return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      }
      const audit = await feedbackService.getAudit(emp.schoolId, id);
      ResponseBuilder.ok({ ...item, audit }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /feedback/me/{id}/respond   { comment }
  public respond = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<RespondRequest>(event, callback);
      if (!body) return;
      const item = await feedbackService.respond(emp.schoolId, id, emp.employeeId, body.comment);
      if (!item) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Feedback not found", callback);
      ResponseBuilder.ok(item, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new FeedbackMeHandler();
export const list = guard(FEEDBACK_ACTIONS["feedback-me-handler.list"], h.list);
export const getById = guard(FEEDBACK_ACTIONS["feedback-me-handler.getById"], h.getById);
export const respond = guard(FEEDBACK_ACTIONS["feedback-me-handler.respond"], h.respond);
