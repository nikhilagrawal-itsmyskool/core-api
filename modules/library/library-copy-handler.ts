import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchoolId, userIdOf } from "./library-common";
import { copyService } from "./library-copy-service";
import { CopyInput } from "./library-interfaces";
import { guard } from "../auth/authz";
import { LIBRARY_ACTIONS } from "./library-actions";

class CopyHandler {
  // Add a batch of copies (a new acquisition) to an existing title.
  public addCopies = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const titleId = event.pathParameters?.id;
      if (!titleId) {
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
      const body = JSON.parse(event.body);
      const copies: CopyInput[] = Array.isArray(body) ? body : body.copies;
      if (!Array.isArray(copies) || copies.length === 0) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "copies array is required",
          callback,
        );
        return;
      }
      const result = await copyService.addCopies(
        titleId,
        copies,
        schoolId,
        userIdOf(event),
      );
      ResponseBuilder.ok({ copies: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // List the copies belonging to a title (for the work detail view).
  public listByTitle = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const titleId = event.pathParameters?.id;
      if (!titleId) {
        ResponseBuilder.badRequest(
          ErrorCode.MissingId,
          "Title ID is required",
          callback,
        );
        return;
      }
      const copies = await copyService.listByTitle(titleId, schoolId);
      ResponseBuilder.ok({ copies }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Search copies by title / author / keyword / accession (for circulation).
  public searchCopies = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const qp = event.queryStringParameters || {};
      const copies = await copyService.search(schoolId, {
        q: qp.q,
        status: qp.status,
        limit: qp.limit ? parseInt(qp.limit, 10) : undefined,
      });
      ResponseBuilder.ok({ copies }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getCopy = async (
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
          "Copy ID is required",
          callback,
        );
        return;
      }
      const copy = await copyService.getById(id, schoolId);
      if (!copy) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Copy not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(copy, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getByAccession = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const accessionNo = event.pathParameters?.accessionNo;
      if (!accessionNo) {
        ResponseBuilder.badRequest(
          ErrorCode.MissingId,
          "Accession number is required",
          callback,
        );
        return;
      }
      const copy = await copyService.getByAccession(accessionNo, schoolId);
      if (!copy) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Copy not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(copy, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateCopy = async (
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
          "Copy ID is required",
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
      const body = JSON.parse(event.body);
      const result = await copyService.update(
        id,
        body,
        schoolId,
        userIdOf(event),
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Copy not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public deleteCopy = async (
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
          "Copy ID is required",
          callback,
        );
        return;
      }
      const existing = await copyService.getById(id, schoolId);
      if (!existing) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Copy not found",
          callback,
        );
        return;
      }
      await copyService.delete(id, schoolId, userIdOf(event));
      ResponseBuilder.ok({ message: "Copy deleted successfully" }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new CopyHandler();
const g = (ref: string, fn: any) => guard(LIBRARY_ACTIONS[ref], fn);
export const addCopies = g("library-copy-handler.addCopies", handler.addCopies);
export const listByTitle = g("library-copy-handler.listByTitle", handler.listByTitle);
export const searchCopies = g("library-copy-handler.searchCopies", handler.searchCopies);
export const getCopy = g("library-copy-handler.getCopy", handler.getCopy);
export const getByAccession = g("library-copy-handler.getByAccession", handler.getByAccession);
export const updateCopy = g("library-copy-handler.updateCopy", handler.updateCopy);
export const deleteCopy = g("library-copy-handler.deleteCopy", handler.deleteCopy);
