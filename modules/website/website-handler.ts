import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { websiteService } from "./website-service";
import { guard } from "../auth/authz";
import { WEBSITE_ACTIONS } from "./website-actions";
import { EVENT_TYPES, ACADEMIC_SESSIONS } from "./website-constants";
import { PushEventRequest } from "./website-interfaces";

// Admin surface for the website publisher (X-School-Code + JWT). Gated by website.publish.
class WebsiteHandler {
  // GET /website/config — whether the module is enabled + the controlled option lists.
  public config = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const enabled = await websiteService.isEnabled(auth.schoolId);
      ResponseBuilder.ok({ enabled, eventTypes: EVENT_TYPES, academicSessions: ACADEMIC_SESSIONS }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /website/tags — live Contentful tags (for the per-image tag picker).
  public tags = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const tags = await websiteService.listTags(auth.schoolId);
      ResponseBuilder.ok(tags, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /website/sources/moments?status= — Moments to curate from.
  public sourceMoments = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const rows = await websiteService.sourceMoments(auth.schoolCode, q.status);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /website/sources/moments/{id} — a moment + its photos.
  public sourceMoment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const m = await websiteService.sourceMoment(auth.schoolCode, id);
      if (!m) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(m, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /website/publications/event — push selected photos (per-image tags) as a School Event.
  public pushEvent = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<PushEventRequest>(event, callback);
      if (!body) return;
      const result = await websiteService.queueEventPush(auth.schoolId, auth.schoolCode, body, auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /website/publications
  public listPublications = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const rows = await websiteService.listPublications(auth.schoolId);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /website/publications/{id}
  public getPublication = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await websiteService.getPublication(auth.schoolId, id);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Publication not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /website/publications/{id}/publish — publish the Contentful entry (if a draft).
  public publish = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await websiteService.publishPublication(auth.schoolId, id, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Publication not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new WebsiteHandler();
const g = (ref: string, fn: any) => guard(WEBSITE_ACTIONS[ref], fn);
export const config = g("website-handler.config", h.config);
export const tags = g("website-handler.tags", h.tags);
export const sourceMoments = g("website-handler.sourceMoments", h.sourceMoments);
export const sourceMoment = g("website-handler.sourceMoment", h.sourceMoment);
export const pushEvent = g("website-handler.pushEvent", h.pushEvent);
export const listPublications = g("website-handler.listPublications", h.listPublications);
export const getPublication = g("website-handler.getPublication", h.getPublication);
export const publish = g("website-handler.publish", h.publish);
