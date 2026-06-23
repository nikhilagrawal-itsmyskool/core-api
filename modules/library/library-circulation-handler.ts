import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchoolId, userIdOf } from "./library-common";
import { circulationService } from "./library-circulation-service";
import {
  IssueRequest,
  ReturnRequest,
  RenewRequest,
} from "./library-interfaces";

class CirculationHandler {
  public issue = async (
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
      const body: IssueRequest = JSON.parse(event.body);
      if (!body.borrowerType || !body.borrowerId) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "borrowerType and borrowerId are required",
          callback,
        );
        return;
      }
      const result = await circulationService.issue(
        body,
        schoolId,
        userIdOf(event),
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public returnBook = async (
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
      const body: ReturnRequest = JSON.parse(event.body);
      const result = await circulationService.returnBook(
        body,
        schoolId,
        userIdOf(event),
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public renew = async (
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
      const body: RenewRequest = JSON.parse(event.body);
      const result = await circulationService.renew(
        body,
        schoolId,
        userIdOf(event),
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
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const qp = event.queryStringParameters || {};
      const result = await circulationService.list(schoolId, {
        status: qp.status,
        copyId: qp.copyId,
        borrowerType: qp.borrowerType,
        borrowerId: qp.borrowerId,
      });
      ResponseBuilder.ok({ circulations: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public loans = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const borrowerType = event.pathParameters?.type;
      const borrowerId = event.pathParameters?.id;
      if (!borrowerType || !borrowerId) {
        ResponseBuilder.badRequest(
          ErrorCode.MissingId,
          "Borrower type and id are required",
          callback,
        );
        return;
      }
      const result = await circulationService.loansByBorrower(
        borrowerType,
        borrowerId,
        schoolId,
      );
      ResponseBuilder.ok({ loans: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new CirculationHandler();
export const issue = handler.issue;
export const returnBook = handler.returnBook;
export const renew = handler.renew;
export const list = handler.list;
export const loans = handler.loans;
