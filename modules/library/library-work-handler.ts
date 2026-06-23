import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchoolId, userIdOf } from "./library-common";
import { catalogService } from "./library-catalog-service";
import { workService } from "./library-work-service";
import { titleService } from "./library-title-service";
import { CatalogRequest, WorkFields, TitleFields } from "./library-interfaces";

class WorkHandler {
  // One-shot catalog: work (or workId) + title + copies.
  public catalog = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      if (!event.body) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "Request body is required",
          callback,
        );
        return;
      }
      const body: CatalogRequest = JSON.parse(event.body);
      const result = await catalogService.catalog(
        body,
        schoolId,
        userIdOf(event),
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public createWork = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      if (!event.body) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "Request body is required",
          callback,
        );
        return;
      }
      const body: WorkFields = JSON.parse(event.body);
      const result = await workService.create(body, schoolId, userIdOf(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public search = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const qp = event.queryStringParameters || {};
      const result = await workService.search(schoolId, {
        q: qp.q,
        limit: qp.limit ? parseInt(qp.limit, 10) : undefined,
        offset: qp.offset ? parseInt(qp.offset, 10) : undefined,
      });
      ResponseBuilder.ok({ works: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Work + its titles (with per-language copy counts) + cross-edition totals.
  public getWork = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(
          ErrorCode.MissingId,
          "Work ID is required",
          callback,
        );
        return;
      }
      const result = await workService.getWithTitles(id, schoolId);
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Work not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateWork = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(
          ErrorCode.MissingId,
          "Work ID is required",
          callback,
        );
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "Request body is required",
          callback,
        );
        return;
      }
      const body: WorkFields = JSON.parse(event.body);
      const result = await workService.update(
        id,
        body,
        schoolId,
        userIdOf(event),
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Work not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Add a new edition/language title under an existing work.
  public addTitle = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const workId = event.pathParameters?.id;
      if (!workId) {
        ResponseBuilder.badRequest(
          ErrorCode.MissingId,
          "Work ID is required",
          callback,
        );
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "Request body is required",
          callback,
        );
        return;
      }
      const body: TitleFields = JSON.parse(event.body);
      const result = await titleService.addToWork(
        workId,
        body,
        schoolId,
        userIdOf(event),
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getTitle = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(
          ErrorCode.MissingId,
          "Title ID is required",
          callback,
        );
        return;
      }
      const title = await titleService.getById(id, schoolId);
      if (!title) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Title not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(title, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateTitle = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(
          ErrorCode.MissingId,
          "Title ID is required",
          callback,
        );
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "Request body is required",
          callback,
        );
        return;
      }
      const body: TitleFields = JSON.parse(event.body);
      const result = await titleService.update(
        id,
        body,
        schoolId,
        userIdOf(event),
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Title not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new WorkHandler();
export const catalog = handler.catalog;
export const createWork = handler.createWork;
export const search = handler.search;
export const getWork = handler.getWork;
export const updateWork = handler.updateWork;
export const addTitle = handler.addTitle;
export const getTitle = handler.getTitle;
export const updateTitle = handler.updateTitle;
