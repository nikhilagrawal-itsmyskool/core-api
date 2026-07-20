import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { assemblyGradingService } from './assembly-grading-service';
import {
  CreateRubricMetricRequest, UpdateRubricMetricRequest, CreateRubricPenaltyRequest,
  UpdateRubricPenaltyRequest, SetRubricConfigRequest, CreateEvaluatorRequest, SaveGradeRequest,
} from './assembly-interfaces';

const ok = (p: Promise<any>, callback: ApiCallback) => p.then(r => ResponseBuilder.ok(r, callback)).catch(e => ResponseBuilder.handleError(e, callback));

class AssemblyGradingHandler {
  // ── Rubric ───────────────────────────────────────────────────────────────────
  public getRubric = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try { const ctx = await resolveSchool(event, callback); if (!ctx) return; await ok(assemblyGradingService.getRubric(ctx.schoolId), callback); }
    catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public setConfig = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const body = parseBody<SetRubricConfigRequest>(event, callback); if (!body) return;
      await ok(assemblyGradingService.setConfig(body, ctx.schoolId, ctx.userId), callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public createMetric = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const body = parseBody<CreateRubricMetricRequest>(event, callback); if (!body) return;
      await ok(assemblyGradingService.createMetric(body, ctx.schoolId, ctx.userId), callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public updateMetric = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const body = parseBody<UpdateRubricMetricRequest>(event, callback); if (!body) return;
      const r = await assemblyGradingService.updateMetric(id, body, ctx.schoolId, ctx.userId);
      if (!r) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Metric not found', callback); return; }
      ResponseBuilder.ok(r, callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public deleteMetric = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const okd = await assemblyGradingService.deleteMetric(id, ctx.schoolId, ctx.userId);
      if (!okd) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Metric not found', callback); return; }
      ResponseBuilder.ok({ message: 'Metric deleted' }, callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public createPenalty = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const body = parseBody<CreateRubricPenaltyRequest>(event, callback); if (!body) return;
      await ok(assemblyGradingService.createPenalty(body, ctx.schoolId, ctx.userId), callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public updatePenalty = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const body = parseBody<UpdateRubricPenaltyRequest>(event, callback); if (!body) return;
      const r = await assemblyGradingService.updatePenalty(id, body, ctx.schoolId, ctx.userId);
      if (!r) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Penalty not found', callback); return; }
      ResponseBuilder.ok(r, callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public deletePenalty = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const okd = await assemblyGradingService.deletePenalty(id, ctx.schoolId, ctx.userId);
      if (!okd) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Penalty not found', callback); return; }
      ResponseBuilder.ok({ message: 'Penalty deleted' }, callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  // ── Evaluators ───────────────────────────────────────────────────────────────
  public listEvaluators = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try { const ctx = await resolveSchool(event, callback); if (!ctx) return; await ok(assemblyGradingService.listEvaluators(ctx.schoolId), callback); }
    catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public addEvaluator = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const body = parseBody<CreateEvaluatorRequest>(event, callback); if (!body) return;
      await ok(assemblyGradingService.addEvaluator(body, ctx.schoolId, ctx.userId), callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public removeEvaluator = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const okd = await assemblyGradingService.removeEvaluator(id, ctx.schoolId, ctx.userId);
      if (!okd) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Evaluator not found', callback); return; }
      ResponseBuilder.ok({ message: 'Evaluator removed' }, callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  // ── Grades ─────────────────────────────────────────────────────────────────
  public listGrades = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const weekId = requireParam(event, 'id', callback); if (!weekId) return;
      await ok(assemblyGradingService.listGrades(weekId, ctx.schoolId), callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public saveGrade = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const weekId = requireParam(event, 'id', callback); if (!weekId) return;
      const body = parseBody<SaveGradeRequest>(event, callback); if (!body) return;
      const r = await assemblyGradingService.saveGrade(weekId, body, ctx.schoolId, ctx.userId);
      if (!r) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(r, callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public getGrade = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const r = await assemblyGradingService.getGrade(id, ctx.schoolId);
      if (!r) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Grade not found', callback); return; }
      ResponseBuilder.ok(r, callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  public deleteGrade = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const okd = await assemblyGradingService.deleteGrade(id, ctx.schoolId, ctx.userId);
      if (!okd) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Grade not found', callback); return; }
      ResponseBuilder.ok({ message: 'Grade deleted' }, callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };

  // ── Leaderboard ──────────────────────────────────────────────────────────────
  public leaderboard = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback); if (!ctx) return;
      const q = event.queryStringParameters || {};
      if (!q.from || !q.to) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'from and to are required', callback); return; }
      await ok(assemblyGradingService.leaderboard(ctx.schoolId, q.from, q.to), callback);
    } catch (e: any) { ResponseBuilder.handleError(e, callback); }
  };
}

const h = new AssemblyGradingHandler();
export const getRubric = h.getRubric;
export const setConfig = h.setConfig;
export const createMetric = h.createMetric;
export const updateMetric = h.updateMetric;
export const deleteMetric = h.deleteMetric;
export const createPenalty = h.createPenalty;
export const updatePenalty = h.updatePenalty;
export const deletePenalty = h.deletePenalty;
export const listEvaluators = h.listEvaluators;
export const addEvaluator = h.addEvaluator;
export const removeEvaluator = h.removeEvaluator;
export const listGrades = h.listGrades;
export const saveGrade = h.saveGrade;
export const getGrade = h.getGrade;
export const deleteGrade = h.deleteGrade;
export const leaderboard = h.leaderboard;
