import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { resolveEmployee, requireParam, parseBody } from "./handler-util";
import { clubPlanService } from "./club-plan-service";
import { CLUB_ACTIONS } from "./club-actions";
import { CompletionRequest } from "./club-interfaces";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Teacher PWA conduct surface: a teacher sees only their OWN published assignments, opens a
// ready-to-conduct guide, and files a sub-minute closure. Ownership is enforced in the service.
class ClubMeHandler {
  // GET /club/me/plan?date=YYYY-MM-DD
  public mySaturday = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const date = (event.queryStringParameters || {}).date || "";
      if (!DATE_RE.test(date)) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "date (YYYY-MM-DD) is required", callback);
      ResponseBuilder.ok(await clubPlanService.myAssignments(emp.schoolId, emp.employeeId, date), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /club/me/assignments/{id}/guide
  public guide = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const g = await clubPlanService.myGuide(emp.schoolId, emp.employeeId, id);
      if (!g) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Assignment not found", callback);
      ResponseBuilder.ok(g, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /club/me/assignments/{id}/close  { outcome, participation..., issueType, qualitySignal, note }
  public close = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<CompletionRequest>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await clubPlanService.completeOwn(emp.schoolId, emp.employeeId, id, body, emp.employeeId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /club/me/assignments/{id}/report-safety  { note }  (immediate escalation, mid-activity)
  public reportSafety = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<{ note?: string }>(event, callback);
      if (!body) return;
      // Record as a not-yet-closed safety signal: mark the completion issue=safety with the note.
      // (Does not force an outcome; the teacher still files the full closure afterwards.)
      ResponseBuilder.ok(
        await clubPlanService.completeOwn(emp.schoolId, emp.employeeId, id,
          { outcome: "partly", issueType: "safety", note: body.note || "Safety concern reported during activity" } as CompletionRequest,
          emp.employeeId),
        callback,
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new ClubMeHandler();
export const mySaturday = guard(CLUB_ACTIONS["club-me-handler.mySaturday"], h.mySaturday);
export const guide = guard(CLUB_ACTIONS["club-me-handler.guide"], h.guide);
export const close = guard(CLUB_ACTIONS["club-me-handler.close"], h.close);
export const reportSafety = guard(CLUB_ACTIONS["club-me-handler.reportSafety"], h.reportSafety);
