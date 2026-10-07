import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { clubService } from "./club-service";
import { CLUB_ACTIONS } from "./club-actions";
import {
  ClubConfigRequest,
  CreateClubRequest,
  SettingsRequest,
  UpdateClubRequest,
} from "./club-interfaces";

// Admin / club-in-charge surface (X-School-Code + JWT). Authz via guard() at the export site.
class ClubHandler {
  public listClubs = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      ResponseBuilder.ok(await clubService.listClubs(auth.schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getClub = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const club = await clubService.getClub(auth.schoolId, id);
      if (!club) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Club not found", callback);
      ResponseBuilder.ok(club, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public createClub = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<CreateClubRequest>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await clubService.createClub(auth.schoolId, body, auth.userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateClub = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<UpdateClubRequest>(event, callback);
      if (!body) return;
      const club = await clubService.updateClub(auth.schoolId, id, body, auth.userId);
      if (!club) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Club not found", callback);
      ResponseBuilder.ok(club, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getConfig = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      ResponseBuilder.ok(await clubService.getConfig(auth.schoolId, id), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateConfig = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<ClubConfigRequest>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await clubService.updateConfig(auth.schoolId, id, body, auth.userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public listGrades = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      ResponseBuilder.ok(await clubService.listGrades(auth.schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getSettings = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      ResponseBuilder.ok(await clubService.getSettings(auth.schoolId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateSettings = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<SettingsRequest>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await clubService.updateSettings(auth.schoolId, body, auth.userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new ClubHandler();
export const listClubs = guard(CLUB_ACTIONS["club-handler.listClubs"], h.listClubs);
export const getClub = guard(CLUB_ACTIONS["club-handler.getClub"], h.getClub);
export const createClub = guard(CLUB_ACTIONS["club-handler.createClub"], h.createClub);
export const updateClub = guard(CLUB_ACTIONS["club-handler.updateClub"], h.updateClub);
export const getConfig = guard(CLUB_ACTIONS["club-handler.getConfig"], h.getConfig);
export const updateConfig = guard(CLUB_ACTIONS["club-handler.updateConfig"], h.updateConfig);
export const listGrades = guard(CLUB_ACTIONS["club-handler.listGrades"], h.listGrades);
export const getSettings = guard(CLUB_ACTIONS["club-handler.getSettings"], h.getSettings);
export const updateSettings = guard(CLUB_ACTIONS["club-handler.updateSettings"], h.updateSettings);
