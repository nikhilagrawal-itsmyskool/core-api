import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchoolId } from "./library-common";
import { copyService } from "./library-copy-service";
import { labelService } from "./library-label-service";

class LabelHandler {
  // Printable QR/barcode for a copy (encodes the accession number).
  public getLabel = async (
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
      const format = (
        event.queryStringParameters?.format === "barcode" ? "barcode" : "qr"
      ) as "qr" | "barcode";
      const result = await labelService.generate(copy.accessionNo, format);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Resolve a scanned accession number to live location + bibliographic summary.
  public resolve = async (
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
      const result = await labelService.resolve(accessionNo, schoolId);
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
}

const handler = new LabelHandler();
export const getLabel = handler.getLabel;
export const resolve = handler.resolve;
