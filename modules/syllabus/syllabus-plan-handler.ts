import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { requireAction } from "../auth/authz";
import { syllabusPlanService } from "./syllabus-plan-service";
import {
  BulkEntriesRequest,
  CreateSyllabusRequest,
  EntryInput,
  ReorderEntriesRequest,
  UpdateSyllabusRequest,
} from "./syllabus-interfaces";

class SyllabusPlanHandler {
  // ── Plans ─────────────────────────────────────────────────────────────────
  public create = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateSyllabusRequest>(event, callback);
      if (!body) return;
      const result = await syllabusPlanService.createSyllabus(
        body,
        ctx.schoolId,
        ctx.userId,
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      // Lists every plan in the school — managers only. Teachers use /my-plans.
      if (!requireAction(event, "syllabus.manage", callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      const results = await syllabusPlanService.listSyllabi(ctx.schoolId, {
        academicYearId: q.academicYearId,
        grade: q.grade,
        streamCode: q.streamCode,
        subjectId: q.subjectId,
      });
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await syllabusPlanService.getSyllabus(id, ctx.schoolId);
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Syllabus not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /syllabi/{id}/source — download the stored source Word doc (base64 JSON).
  public getSource = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const file = await syllabusPlanService.getSourceFile(id, ctx.schoolId);
      if (!file) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "No source document for this plan", callback);
        return;
      }
      ResponseBuilder.ok({ fileName: file.fileName, mimeType: file.mimeType, base64Data: file.base64 }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<UpdateSyllabusRequest>(event, callback);
      if (!body) return;
      const result = await syllabusPlanService.updateSyllabus(
        id,
        body,
        ctx.schoolId,
        ctx.userId,
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Syllabus not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const deleted = await syllabusPlanService.deleteSyllabus(
        id,
        ctx.schoolId,
        ctx.userId,
      );
      if (!deleted) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Syllabus not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(
        { message: "Syllabus deleted successfully" },
        callback,
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ── Entries ─────────────────────────────────────────────────────────────
  public addEntry = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<EntryInput>(event, callback);
      if (!body) return;
      const result = await syllabusPlanService.addEntry(
        id,
        body,
        ctx.schoolId,
        ctx.userId,
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Syllabus not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public bulkEntries = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<BulkEntriesRequest>(event, callback);
      if (!body) return;
      const result = await syllabusPlanService.bulkEntries(
        id,
        body,
        ctx.schoolId,
        ctx.userId,
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Syllabus not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public reorderEntries = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<ReorderEntriesRequest>(event, callback);
      if (!body) return;
      const result = await syllabusPlanService.reorderEntries(
        id,
        body,
        ctx.schoolId,
        ctx.userId,
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Syllabus not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateEntry = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<EntryInput>(event, callback);
      if (!body) return;
      const result = await syllabusPlanService.updateEntry(
        id,
        body,
        ctx.schoolId,
        ctx.userId,
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Entry not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public removeEntry = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const deleted = await syllabusPlanService.deleteEntry(
        id,
        ctx.schoolId,
        ctx.userId,
      );
      if (!deleted) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Entry not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok({ message: "Entry deleted successfully" }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SyllabusPlanHandler();
export const create = handler.create;
export const list = handler.list;
export const getById = handler.getById;
export const getSource = handler.getSource;
export const update = handler.update;
export const remove = handler.remove;
export const addEntry = handler.addEntry;
export const bulkEntries = handler.bulkEntries;
export const reorderEntries = handler.reorderEntries;
export const updateEntry = handler.updateEntry;
export const removeEntry = handler.removeEntry;
