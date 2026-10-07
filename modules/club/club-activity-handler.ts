import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { clubActivityService, ActivityFilters } from "./club-activity-service";
import { CLUB_ACTIONS } from "./club-actions";
import {
  CreateActivityRequest,
  MaterialLine,
  UpdateDraftRequest,
} from "./club-interfaces";

class ClubActivityHandler {
  // GET /club/activities?clubId=&gradeLevel=&category=&versionStatus=&availability=&search=
  public listActivities = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const filters: ActivityFilters = {
        clubId: q.clubId,
        gradeLevel: q.gradeLevel,
        category: q.category,
        versionStatus: q.versionStatus,
        availability: q.availability,
        search: q.search,
      };
      ResponseBuilder.ok(await clubActivityService.listActivities(auth.schoolId, filters), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /club/activities/{id}
  public getActivity = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const a = await clubActivityService.getActivity(auth.schoolId, id);
      if (!a) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Activity not found", callback);
      ResponseBuilder.ok(a, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /club/activities { clubId, activityCode, content, materials? }
  public createActivity = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<CreateActivityRequest>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await clubActivityService.createActivity(auth.schoolId, body, auth.userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /club/activities/{id}/draft  (edit latest Draft content in place)
  public updateDraft = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<UpdateDraftRequest>(event, callback);
      if (!body) return;
      const a = await clubActivityService.updateDraft(auth.schoolId, id, body, auth.userId);
      if (!a) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Activity not found", callback);
      ResponseBuilder.ok(a, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /club/activities/{id}/revise  (clone current version into a new Draft)
  public createRevision = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const a = await clubActivityService.createRevision(auth.schoolId, id, auth.userId);
      if (!a) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Activity not found", callback);
      ResponseBuilder.ok(a, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /club/activities/{id}/materials  { materials: [...] }  (Draft only)
  public replaceMaterials = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<{ materials: MaterialLine[] }>(event, callback);
      if (!body) return;
      const a = await clubActivityService.replaceMaterials(auth.schoolId, id, body.materials || [], auth.userId);
      if (!a) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Activity not found", callback);
      ResponseBuilder.ok(a, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /club/activities/{id}/approve  { versionId }
  public approve = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<{ versionId: string }>(event, callback);
      if (!body) return;
      if (!body.versionId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "versionId is required", callback);
      const a = await clubActivityService.approve(auth.schoolId, id, body.versionId, auth.userId);
      if (!a) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Activity or version not found", callback);
      ResponseBuilder.ok(a, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /club/activities/{id}/availability  { availability, reason? }
  public setAvailability = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<{ availability: string; reason?: string }>(event, callback);
      if (!body) return;
      const a = await clubActivityService.setAvailability(auth.schoolId, id, body.availability, auth.userId, body.reason);
      if (!a) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Activity not found", callback);
      ResponseBuilder.ok(a, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /club/reviews?status=open|closed|all
  public listReviews = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const status = (event.queryStringParameters || {}).status || "open";
      ResponseBuilder.ok(await clubActivityService.listReviews(auth.schoolId, status), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /club/reviews/{id}/decide  { decision, note? }
  public decideReview = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<{ decision: string; note?: string }>(event, callback);
      if (!body) return;
      const r = await clubActivityService.decideReview(auth.schoolId, id, body.decision, body.note || "", auth.userId);
      if (!r) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Review not found", callback);
      ResponseBuilder.ok(r, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /club/activities/{id}/flag  { note? }
  public flagReview = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<{ note?: string }>(event, callback);
      if (!body) return;
      const r = await clubActivityService.flagReview(auth.schoolId, id, body.note || "", auth.userId);
      if (!r) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Activity not found", callback);
      ResponseBuilder.ok(r, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new ClubActivityHandler();
export const listActivities = guard(CLUB_ACTIONS["club-activity-handler.listActivities"], h.listActivities);
export const getActivity = guard(CLUB_ACTIONS["club-activity-handler.getActivity"], h.getActivity);
export const createActivity = guard(CLUB_ACTIONS["club-activity-handler.createActivity"], h.createActivity);
export const updateDraft = guard(CLUB_ACTIONS["club-activity-handler.updateDraft"], h.updateDraft);
export const createRevision = guard(CLUB_ACTIONS["club-activity-handler.createRevision"], h.createRevision);
export const replaceMaterials = guard(CLUB_ACTIONS["club-activity-handler.replaceMaterials"], h.replaceMaterials);
export const approve = guard(CLUB_ACTIONS["club-activity-handler.approve"], h.approve);
export const setAvailability = guard(CLUB_ACTIONS["club-activity-handler.setAvailability"], h.setAvailability);
export const listReviews = guard(CLUB_ACTIONS["club-activity-handler.listReviews"], h.listReviews);
export const decideReview = guard(CLUB_ACTIONS["club-activity-handler.decideReview"], h.decideReview);
export const flagReview = guard(CLUB_ACTIONS["club-activity-handler.flagReview"], h.flagReview);
