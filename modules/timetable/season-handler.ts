import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { TIMETABLE_ACTIONS } from "./timetable-actions";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { seasonService } from "./season-service";
import {
  CreateSeasonRequest,
  UpdateSeasonRequest,
  SetSeasonSlotTimesRequest,
  PrefillSeasonRequest,
  CreateSeasonActivationRequest,
  UpdateSeasonActivationRequest,
} from "./timetable-interfaces";
import { CONFIG_STATUS_VALUES } from "./timetable-constants";

class SeasonHandler {
  // ----- seasons -----
  public list = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const seasons = await seasonService.listSeasons(ctx.schoolId);
      ResponseBuilder.ok({ seasons }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const season = await seasonService.getSeasonById(id, ctx.schoolId);
      if (!season) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Season not found", callback);
        return;
      }
      ResponseBuilder.ok(season, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateSeasonRequest>(event, callback);
      if (!body) return;
      if (!body.name || !body.name.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "name is required", callback);
        return;
      }
      const season = await seasonService.createSeason(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(season, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<UpdateSeasonRequest>(event, callback);
      if (!body) return;
      if (body.status !== undefined && !CONFIG_STATUS_VALUES.includes(body.status)) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          `status must be one of: ${CONFIG_STATUS_VALUES.join(", ")}`,
          callback,
        );
        return;
      }
      const season = await seasonService.updateSeason(id, body, ctx.schoolId, ctx.userId);
      if (!season) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Season not found", callback);
        return;
      }
      ResponseBuilder.ok(season, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      if (!(await seasonService.seasonExists(id, ctx.schoolId))) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Season not found", callback);
        return;
      }
      await seasonService.archiveSeason(id, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ message: "Season archived successfully" }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ----- per-slot times -----
  public listSlotTimes = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      if (!(await seasonService.seasonExists(id, ctx.schoolId))) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Season not found", callback);
        return;
      }
      const slotTimes = await seasonService.listSlotTimes(id, ctx.schoolId);
      ResponseBuilder.ok({ slotTimes }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public setSlotTimes = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      if (!(await seasonService.seasonExists(id, ctx.schoolId))) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Season not found", callback);
        return;
      }
      const body = parseBody<SetSeasonSlotTimesRequest>(event, callback);
      if (!body) return;
      if (!Array.isArray(body.slotTimes)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "slotTimes must be an array", callback);
        return;
      }
      const slotTimes = await seasonService.setSlotTimes(id, body.slotTimes, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ slotTimes }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public prefill = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      if (!(await seasonService.seasonExists(id, ctx.schoolId))) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Season not found", callback);
        return;
      }
      const body = parseBody<PrefillSeasonRequest>(event, callback);
      if (!body) return;
      if (!body.configId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "configId is required", callback);
        return;
      }
      const slotTimes = await seasonService.prefillFromBase(id, body.configId, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ slotTimes }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public removeSlotTime = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const slotTimeId = requireParam(event, "slotTimeId", callback);
      if (!slotTimeId) return;
      const ok = await seasonService.deleteSlotTime(slotTimeId, ctx.schoolId);
      if (!ok) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Slot time not found", callback);
        return;
      }
      ResponseBuilder.ok({ message: "Slot time removed successfully" }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ----- activations -----
  public listActivations = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      const activations = await seasonService.listActivations(ctx.schoolId, qp.seasonId);
      ResponseBuilder.ok({ activations }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public createActivation = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateSeasonActivationRequest>(event, callback);
      if (!body) return;
      if (!body.seasonId || !body.effectiveFrom) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "seasonId and effectiveFrom are required",
          callback,
        );
        return;
      }
      if (!(await seasonService.seasonExists(body.seasonId, ctx.schoolId))) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Invalid seasonId", callback);
        return;
      }
      const activation = await seasonService.createActivation(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(activation, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateActivation = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const activationId = requireParam(event, "activationId", callback);
      if (!activationId) return;
      const body = parseBody<UpdateSeasonActivationRequest>(event, callback);
      if (!body) return;
      const activation = await seasonService.updateActivation(activationId, body, ctx.schoolId, ctx.userId);
      if (!activation) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Activation not found", callback);
        return;
      }
      ResponseBuilder.ok(activation, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public removeActivation = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const activationId = requireParam(event, "activationId", callback);
      if (!activationId) return;
      const ok = await seasonService.deleteActivation(activationId, ctx.schoolId);
      if (!ok) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Activation not found", callback);
        return;
      }
      ResponseBuilder.ok({ message: "Activation removed successfully" }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SeasonHandler();
export const list = guard(TIMETABLE_ACTIONS['season-handler.list'], handler.list);
export const getById = guard(TIMETABLE_ACTIONS['season-handler.getById'], handler.getById);
export const create = guard(TIMETABLE_ACTIONS['season-handler.create'], handler.create);
export const update = guard(TIMETABLE_ACTIONS['season-handler.update'], handler.update);
export const remove = guard(TIMETABLE_ACTIONS['season-handler.remove'], handler.remove);
export const listSlotTimes = guard(TIMETABLE_ACTIONS['season-handler.listSlotTimes'], handler.listSlotTimes);
export const setSlotTimes = guard(TIMETABLE_ACTIONS['season-handler.setSlotTimes'], handler.setSlotTimes);
export const prefill = guard(TIMETABLE_ACTIONS['season-handler.prefill'], handler.prefill);
export const removeSlotTime = guard(TIMETABLE_ACTIONS['season-handler.removeSlotTime'], handler.removeSlotTime);
export const listActivations = guard(TIMETABLE_ACTIONS['season-handler.listActivations'], handler.listActivations);
export const createActivation = guard(TIMETABLE_ACTIONS['season-handler.createActivation'], handler.createActivation);
export const updateActivation = guard(TIMETABLE_ACTIONS['season-handler.updateActivation'], handler.updateActivation);
export const removeActivation = guard(TIMETABLE_ACTIONS['season-handler.removeActivation'], handler.removeActivation);
