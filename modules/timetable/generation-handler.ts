import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { generationService } from './generation-service';

interface GenerateBody { configId: string; academicYearId?: string; objectiveWeights?: any; numCandidates?: number; wingId?: string | null; }
interface PublishBody { candidateId: string; effectiveFrom?: string; }
interface ValidateMoveBody { publishedTimetableId: string; entryId: string; toDayOfWeek: number; toTimeSlotId: string; }

class GenerationHandler {
  public feasibility = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<GenerateBody>(event, callback);
      if (!body) return;
      if (!body.configId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'configId is required', callback); return; }
      const report = await generationService.feasibility(ctx.schoolId, body.configId, body.wingId);
      ResponseBuilder.ok(report, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public generate = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<GenerateBody>(event, callback);
      if (!body) return;
      if (!body.configId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'configId is required', callback); return; }
      const numCandidates = Number.isInteger(body.numCandidates) && body.numCandidates! > 0 ? Math.min(body.numCandidates!, 5) : 3;
      const runId = await generationService.enqueue(ctx.schoolId, body.configId, body.academicYearId || '', body.objectiveWeights, numCandidates, ctx.userId, body.wingId);
      ResponseBuilder.ok({ runId, status: 'queued' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getRun = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const run = await generationService.getRun(id, ctx.schoolId);
      if (!run) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Run not found', callback); return; }
      ResponseBuilder.ok(run, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getCandidates = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const candidates = await generationService.getCandidates(id, ctx.schoolId);
      ResponseBuilder.ok({ candidates }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Internal: claim and process one queued run. Called by the worker poller.
  // Not school-scoped (operates across all schools' queues).
  public processNext = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const workerId = (body.workerId || 'worker').toString().slice(0, 64);
      const result = await generationService.processNext(workerId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public publish = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<PublishBody>(event, callback);
      if (!body) return;
      if (!body.candidateId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'candidateId is required', callback); return; }
      const result = await generationService.publish(ctx.schoolId, body.candidateId, body.effectiveFrom || null, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getPublished = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const academicYearId = event.queryStringParameters?.academicYearId;
      if (!academicYearId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId is required', callback); return; }
      const wingId = event.queryStringParameters?.wingId || null;
      const result = await generationService.getActivePublished(ctx.schoolId, academicYearId, wingId);
      ResponseBuilder.ok(result || { publishedTimetable: null, entries: [], config: null }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public listPublished = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const academicYearId = event.queryStringParameters?.academicYearId;
      if (!academicYearId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId is required', callback); return; }
      const published = await generationService.listActivePublished(ctx.schoolId, academicYearId);
      ResponseBuilder.ok({ published }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public validateMove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<ValidateMoveBody>(event, callback);
      if (!body) return;
      if (!body.publishedTimetableId || !body.entryId || !body.toTimeSlotId || !Number.isInteger(body.toDayOfWeek)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'publishedTimetableId, entryId, toDayOfWeek and toTimeSlotId are required', callback); return;
      }
      const result = await generationService.validateMove(ctx.schoolId, body.publishedTimetableId, body.entryId, body.toDayOfWeek, body.toTimeSlotId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new GenerationHandler();
export const feasibility = handler.feasibility;
export const generate = handler.generate;
export const getRun = handler.getRun;
export const getCandidates = handler.getCandidates;
export const processNext = handler.processNext;
export const publish = handler.publish;
export const getPublished = handler.getPublished;
export const listPublished = handler.listPublished;
export const validateMove = handler.validateMove;
