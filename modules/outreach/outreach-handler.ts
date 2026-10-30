import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { outreachService } from "./outreach-service";
import { notifyMomentPublished } from "./outreach-notify";
import { guard } from "../auth/authz";
import { OUTREACH_ACTIONS } from "./outreach-actions";
import {
  CreateMomentRequest,
  UpdateMomentRequest,
  AddPhotoRequest,
  AddVideoRequest,
  VideoUploadUrlRequest,
  AddR2VideoRequest,
  ScheduleRequest,
} from "./outreach-interfaces";

// Admin/compose surface (X-School-Code + JWT). Admin can target any audience. The
// teacher PWA (/me) surface is a separate, own-class-scoped handler.
class OutreachHandler {
  // POST /outreach/moments {title?, body?, audience:[{scope,refId?}]}
  public createMoment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<CreateMomentRequest>(event, callback);
      if (!body) return;
      const result = await outreachService.createMoment(auth.schoolId, body, auth.userId, auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /outreach/moments?status=&classId=&limit=&offset=
  public listMoments = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const rows = await outreachService.listMoments(auth.schoolId, {
        status: q.status,
        classId: q.classId,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
        offset: q.offset ? parseInt(q.offset, 10) : undefined,
      });
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /outreach/moments/{id}
  public getMoment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await outreachService.getMoment(auth.schoolId, id, { reactorId: null });
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /outreach/moments/{id}/reactions — admin: who reacted (names). Not in the feed.
  public getReactions = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await outreachService.reactionDetail(auth.schoolId, id);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /outreach/moments/{id} {title?, body?, audience?}
  public updateMoment = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<UpdateMomentRequest>(event, callback);
      if (!body) return;
      const result = await outreachService.updateMoment(auth.schoolId, id, body, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/moments/{id}/photos {image, caption?}
  public addPhoto = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<AddPhotoRequest>(event, callback);
      if (!body) return;
      const result = await outreachService.addPhoto(auth.schoolId, id, body, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /outreach/moments/{id}/photos/{photoId}
  public removePhoto = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const photoId = requireParam(event, "photoId", callback);
      if (!photoId) return;
      const result = await outreachService.removePhoto(auth.schoolId, id, photoId, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment or photo not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /outreach/moments/{id}/photos/{photoId}/image — raw base64 (fallback / local dev)
  public getPhotoImage = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const photoId = requireParam(event, "photoId", callback);
      if (!photoId) return;
      const img = await outreachService.getPhotoImage(auth.schoolId, photoId);
      if (!img) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Image not found", callback);
      ResponseBuilder.ok(
        { mimeType: img.mimeType, fileName: img.fileName, dataUri: `data:${img.mimeType};base64,${img.data}` },
        callback,
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/moments/{id}/publish — publish + fan out the in-app notification.
  public publish = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await outreachService.publish(auth.schoolId, id, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      // Best-effort notification — never blocks the publish response.
      const studentIds = await outreachService.resolveAudienceStudentIds(auth.schoolId, id);
      await notifyMomentPublished(auth.schoolCode, studentIds, id, result);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/moments/{id}/unpublish
  public unpublish = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await outreachService.unpublish(auth.schoolId, id, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /outreach/moments/{id}/audit
  public getAudit = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const rows = await outreachService.getAudit(auth.schoolId, id);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /outreach/audience-options — grades + base classes for the audience picker.
  public audienceOptions = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const result = await outreachService.audienceOptions(auth.schoolId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/moments/{id}/videos {url, caption?}
  public addVideo = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<AddVideoRequest>(event, callback);
      if (!body) return;
      if (!body.url) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "url is required", callback);
      const result = await outreachService.addVideo(auth.schoolId, id, body, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/moments/{id}/videos/upload-url {fileName, mimeType, sizeBytes, durationSeconds}
  // → presigned R2 PUT URL for a direct browser upload (step 1 of 2).
  public videoUploadUrl = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<VideoUploadUrlRequest>(event, callback);
      if (!body) return;
      if (!body.mimeType || !body.sizeBytes) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "mimeType and sizeBytes are required", callback);
      }
      const result = await outreachService.videoUploadUrl(auth.schoolId, id, body);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/moments/{id}/videos/r2 {storageKey, mimeType, sizeBytes, durationSeconds, caption}
  // → record the uploaded clip on the moment (step 2 of 2).
  public addR2Video = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<AddR2VideoRequest>(event, callback);
      if (!body) return;
      if (!body.storageKey) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "storageKey is required", callback);
      const result = await outreachService.addR2Video(auth.schoolId, id, body, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /outreach/moments/{id}/videos/{videoId}
  public removeVideo = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const videoId = requireParam(event, "videoId", callback);
      if (!videoId) return;
      const result = await outreachService.removeVideo(auth.schoolId, id, videoId, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment or video not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/moments/{id}/schedule {publishAt}
  public schedule = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<ScheduleRequest>(event, callback);
      if (!body) return;
      if (!body.publishAt) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "publishAt is required", callback);
      const result = await outreachService.schedule(auth.schoolId, id, body.publishAt, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /outreach/moments/{id}/unschedule
  public unschedule = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await outreachService.cancelSchedule(auth.schoolId, id, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Moment not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new OutreachHandler();
const g = (ref: string, fn: any) => guard(OUTREACH_ACTIONS[ref], fn);
export const createMoment = g("outreach-handler.createMoment", h.createMoment);
export const listMoments = g("outreach-handler.listMoments", h.listMoments);
export const getMoment = g("outreach-handler.getMoment", h.getMoment);
export const getReactions = g("outreach-handler.getReactions", h.getReactions);
export const updateMoment = g("outreach-handler.updateMoment", h.updateMoment);
export const addPhoto = g("outreach-handler.addPhoto", h.addPhoto);
export const removePhoto = g("outreach-handler.removePhoto", h.removePhoto);
export const getPhotoImage = g("outreach-handler.getPhotoImage", h.getPhotoImage);
export const publish = g("outreach-handler.publish", h.publish);
export const unpublish = g("outreach-handler.unpublish", h.unpublish);
export const getAudit = g("outreach-handler.getAudit", h.getAudit);
export const audienceOptions = g("outreach-handler.audienceOptions", h.audienceOptions);
export const addVideo = g("outreach-handler.addVideo", h.addVideo);
export const videoUploadUrl = g("outreach-handler.videoUploadUrl", h.videoUploadUrl);
export const addR2Video = g("outreach-handler.addR2Video", h.addR2Video);
export const removeVideo = g("outreach-handler.removeVideo", h.removeVideo);
export const schedule = g("outreach-handler.schedule", h.schedule);
export const unschedule = g("outreach-handler.unschedule", h.unschedule);
