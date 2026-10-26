import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guard } from '../auth/authz';
import { policyService } from './policy-service';
import { STAFF_ATTENDANCE_ACTIONS } from './staff-attendance-actions';
import { resolveSchool, parseBody, requireParam } from './handler-util';

// god-only Config surface: policy defaults + seasonal timing windows.
class ConfigHandler {
  getConfig = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      ResponseBuilder.ok(await policyService.getConfig(ctx.schoolId), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  updateConfig = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await policyService.upsertConfig(ctx.schoolId, ctx.userId, body), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  listSeasons = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      ResponseBuilder.ok(await policyService.listSeasons(ctx.schoolId), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  createSeason = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await policyService.createSeason(ctx.schoolId, ctx.userId, body), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  updateSeason = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await policyService.updateSeason(ctx.schoolId, ctx.userId, id, body), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };

  deleteSeason = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      ResponseBuilder.ok(await policyService.deleteSeason(ctx.schoolId, ctx.userId, id), callback);
    } catch (err) { ResponseBuilder.handleError(err as Error, callback); }
  };
}

const h = new ConfigHandler();
const g = (ref: string, fn: any) => guard(STAFF_ATTENDANCE_ACTIONS[ref], fn);

export const getConfig = g('config-handler.getConfig', h.getConfig);
export const updateConfig = g('config-handler.updateConfig', h.updateConfig);
export const listSeasons = g('config-handler.listSeasons', h.listSeasons);
export const createSeason = g('config-handler.createSeason', h.createSeason);
export const updateSeason = g('config-handler.updateSeason', h.updateSeason);
export const deleteSeason = g('config-handler.deleteSeason', h.deleteSeason);
