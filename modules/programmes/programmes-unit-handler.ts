import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { guard } from "../auth/authz";
import { PROGRAMME_ACTIONS } from "./programmes-actions";
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
const g = (ref: string, fn: any) => guard(PROGRAMME_ACTIONS[ref], fn);
export const list = g("programmes-unit-handler.list", handler.list);
export const getById = g("programmes-unit-handler.getById", handler.getById);
export const create = g("programmes-unit-handler.create", handler.create);
export const update = g("programmes-unit-handler.update", handler.update);
export const remove = g("programmes-unit-handler.remove", handler.remove);
export const teach = g("programmes-unit-handler.teach", handler.teach);
