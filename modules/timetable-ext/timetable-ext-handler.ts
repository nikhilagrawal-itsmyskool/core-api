import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guard } from '../auth/authz';
import { resolveSchool, parseBody, requireParam } from '../timetable/handler-util';
import { generationService } from '../timetable/generation-service';
import { TIMETABLE_EXT_ACTIONS } from './timetable-ext-actions';

// timetable-ext service handlers. This second stack exists only because the primary
// `timetable` service is at CloudFormation's 500-resource limit; the business logic lives
// in the timetable module (generationService) and is imported here, so there is a single
// source of truth. See modules/timetable/DESIGN.md "manual master".
interface CreateManualBody { academicYearId: string; wingId?: string | null; configId: string; }
interface CreateEntryBody { publishedTimetableId: string; classId: string; dayOfWeek: number; timeSlotId: string; subjectId?: string | null; teacherId?: string | null; label?: string | null; }
interface ActivateDraftBody { effectiveFrom?: string; }

class TimetableExtHandler {
  // Create an empty draft master for (year, wing) against a grid config.
  public createManualMaster = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateManualBody>(event, callback);
      if (!body) return;
      if (!body.academicYearId || !body.configId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId and configId are required', callback); return;
      }
      const result = await generationService.createManualMaster(ctx.schoolId, body.academicYearId, body.wingId ?? null, body.configId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Load a specific master (draft or active) + entries + config — the editor's load surface.
  public getPublishedById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const result = await generationService.getPublishedById(ctx.schoolId, id);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Master not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Fill a cell (label and/or subject+teacher). Clash-checked.
  public createEntry = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateEntryBody>(event, callback);
      if (!body) return;
      if (!body.publishedTimetableId || !body.classId || !body.timeSlotId || !Number.isInteger(body.dayOfWeek)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'publishedTimetableId, classId, dayOfWeek and timeSlotId are required', callback); return;
      }
      const result = await generationService.createPublishedEntry(ctx.schoolId, body.publishedTimetableId, {
        classId: body.classId, dayOfWeek: body.dayOfWeek, timeSlotId: body.timeSlotId,
        subjectId: body.subjectId, teacherId: body.teacherId, label: body.label,
      }, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Clear a cell row.
  public deleteEntry = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const entryId = requireParam(event, 'id', callback);
      if (!entryId) return;
      const publishedTimetableId = event.queryStringParameters?.publishedTimetableId;
      if (!publishedTimetableId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'publishedTimetableId is required', callback); return; }
      const result = await generationService.deletePublishedEntry(ctx.schoolId, publishedTimetableId, entryId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Activate a draft master (archives the prior active master for the same scope).
  public activateDraft = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<ActivateDraftBody>(event, callback) ?? ({} as ActivateDraftBody);
      const result = await generationService.activateDraft(ctx.schoolId, id, body.effectiveFrom || null, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new TimetableExtHandler();
export const createManualMaster = guard(TIMETABLE_EXT_ACTIONS['timetable-ext-handler.createManualMaster'], handler.createManualMaster);
export const getPublishedById = guard(TIMETABLE_EXT_ACTIONS['timetable-ext-handler.getPublishedById'], handler.getPublishedById);
export const createEntry = guard(TIMETABLE_EXT_ACTIONS['timetable-ext-handler.createEntry'], handler.createEntry);
export const deleteEntry = guard(TIMETABLE_EXT_ACTIONS['timetable-ext-handler.deleteEntry'], handler.deleteEntry);
export const activateDraft = guard(TIMETABLE_EXT_ACTIONS['timetable-ext-handler.activateDraft'], handler.activateDraft);
