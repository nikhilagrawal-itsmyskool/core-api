import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { requireAction } from "../auth/authz";
import { programmeUnitService } from "./programmes-unit-service";
import { CreateUnitRequest, UpdateUnitRequest } from "./programmes-interfaces";

class ProgrammesUnitHandler {
  // GET /units?programme=&grade=&month=&academicYearId= — admin editor list.
  public list = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, "programme.view", callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      if (!q.programme || !q.grade) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "programme and grade are required",
          callback,
        );
        return;
      }
      const rows = await programmeUnitService.list(ctx.schoolId, {
        programmeCode: q.programme,
        grade: q.grade,
        month: q.month,
        academicYearId: q.academicYearId,
      });
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /units/{id} — the raw unit (fields JSON + focus skill ids) for editing.
  public getById = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, "programme.view", callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const unit = await programmeUnitService.getById(id, ctx.schoolId);
      if (!unit) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Unit not found", callback);
        return;
      }
      ResponseBuilder.ok(unit, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, "programme.manage", callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateUnitRequest>(event, callback);
      if (!body) return;
      const result = await programmeUnitService.create(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
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
      if (!requireAction(event, "programme.manage", callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<UpdateUnitRequest>(event, callback);
      if (!body) return;
      const result = await programmeUnitService.update(id, body, ctx.schoolId, ctx.userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Unit not found", callback);
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
      if (!requireAction(event, "programme.manage", callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const deleted = await programmeUnitService.delete(id, ctx.schoolId, ctx.userId);
      if (!deleted) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Unit not found", callback);
        return;
      }
      ResponseBuilder.ok({ message: "Unit deleted" }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /teach?programme=&grade=&month=&academicYearId= — the teacher reader page.
  public teach = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, "programme.view", callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      if (!q.programme || !q.grade || !q.month) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "programme, grade and month are required",
          callback,
        );
        return;
      }
      const result = await programmeUnitService.teach(ctx.schoolId, {
        programmeCode: q.programme,
        grade: q.grade,
        month: q.month,
        academicYearId: q.academicYearId,
      });
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Programme not found", callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ProgrammesUnitHandler();
export const list = handler.list;
export const getById = handler.getById;
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
export const teach = handler.teach;
