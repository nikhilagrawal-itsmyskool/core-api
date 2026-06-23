import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchoolId, userIdOf } from "./library-common";
import { fineService } from "./library-fine-service";
import { CollectFineRequest, WaiveFineRequest } from "./library-interfaces";

class FineHandler {
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
      const result = await fineService.list(schoolId, {
        status: qp.status,
        borrowerType: qp.borrowerType,
        borrowerId: qp.borrowerId,
      });
      ResponseBuilder.ok({ fines: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public collect = async (
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
          "Fine ID is required",
          callback,
        );
        return;
      }
      const body: CollectFineRequest = event.body ? JSON.parse(event.body) : {};
      const result = await fineService.collect(
        id,
        body,
        schoolId,
        userIdOf(event),
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Fine not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public waive = async (
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
          "Fine ID is required",
          callback,
        );
        return;
      }
      const body: WaiveFineRequest = event.body ? JSON.parse(event.body) : {};
      const result = await fineService.waive(
        id,
        body,
        schoolId,
        userIdOf(event),
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Fine not found",
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

const handler = new FineHandler();
export const list = handler.list;
export const collect = handler.collect;
export const waive = handler.waive;
