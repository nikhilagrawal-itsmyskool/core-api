import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchoolId, userIdOf } from "./library-common";
import { lookupService } from "./library-lookup-service";
import { ddcService } from "./library-ddc-service";
import { authorService } from "./library-author-service";
import { callnoService } from "./library-callno-service";
import { isbnService } from "./library-isbn-service";
import { workService } from "./library-work-service";
import {
  LANGUAGES,
  COPY_STATUSES,
  BOOK_CONDITIONS,
  LOST_CHARGE_MODES,
  BORROWER_TYPES,
  FINE_TYPES,
  STANDARD_SUBDIVISIONS,
  LookupType,
} from "./library-constants";
import { CreateLookupRequest, UpdateLookupRequest } from "./library-interfaces";

class LookupHandler {
  // ---- Per-school managed lookups ----
  public listLookups = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const type = event.pathParameters?.type as LookupType | undefined;
      const result = await lookupService.list(type, schoolId, userIdOf(event));
      ResponseBuilder.ok({ lookups: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public createLookup = async (
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
      const body: CreateLookupRequest = JSON.parse(event.body);
      if (
        !body.code ||
        !body.code.trim() ||
        !body.label ||
        !body.label.trim()
      ) {
        ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "code and label are required",
          callback,
        );
        return;
      }
      const result = await lookupService.create(
        body,
        schoolId,
        userIdOf(event),
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateLookup = async (
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
          "Lookup ID is required",
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
      const body: UpdateLookupRequest = JSON.parse(event.body);
      const result = await lookupService.update(
        id,
        body,
        schoolId,
        userIdOf(event),
      );
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "Lookup not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public deleteLookup = async (
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
          "Lookup ID is required",
          callback,
        );
        return;
      }
      await lookupService.delete(id, schoolId, userIdOf(event));
      ResponseBuilder.ok({ message: "Lookup deleted successfully" }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ---- DDC (global reference) ----
  public getDdc = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const q = event.queryStringParameters?.q;
      const result = await ddcService.list(q);
      ResponseBuilder.ok({ ddc: result }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getDdcByCode = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const code = event.pathParameters?.code;
      if (!code) {
        ResponseBuilder.badRequest(
          ErrorCode.MissingId,
          "DDC code is required",
          callback,
        );
        return;
      }
      const result = await ddcService.getByCode(code);
      if (!result) {
        ResponseBuilder.notFound(
          ErrorCode.InvalidId,
          "DDC code not found",
          callback,
        );
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ---- Author normalization preview ----
  public normalizeAuthor = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const input = body.input || body.author || "";
      ResponseBuilder.ok(authorService.normalize(input), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ---- Call number preview (with collision check) ----
  public generateCallNo = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const body = event.body ? JSON.parse(event.body) : {};
      let cutter = body.cutter;
      if (!cutter && body.firstAuthorSurname)
        cutter = authorService.toRomanCutter(body.firstAuthorSurname);
      const localCallNo = callnoService.generate(
        cutter,
        body.ddcNumber,
        body.language,
      );
      const collisions = await callnoService.findCollisions(
        localCallNo,
        schoolId,
        body.workId,
      );
      ResponseBuilder.ok({ localCallNo, cutter, collisions }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ---- ISBN external lookup (best-effort) ----
  public isbnLookup = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const isbn = event.pathParameters?.isbn;
      if (!isbn) {
        ResponseBuilder.badRequest(
          ErrorCode.MissingId,
          "ISBN is required",
          callback,
        );
        return;
      }
      const result = await isbnService.lookup(isbn);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ---- Keyword suggestions (autocomplete) ----
  public getKeywords = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const q = event.queryStringParameters?.q;
      const keywords = await workService.suggestKeywords(schoolId, q);
      ResponseBuilder.ok({ keywords }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ---- Static enums ----
  public getStaticLookups = (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok(
      {
        languages: LANGUAGES,
        copyStatuses: COPY_STATUSES,
        bookConditions: BOOK_CONDITIONS,
        lostChargeModes: LOST_CHARGE_MODES,
        borrowerTypes: BORROWER_TYPES,
        fineTypes: FINE_TYPES,
        standardSubdivisions: STANDARD_SUBDIVISIONS,
      },
      callback,
    );
  };

  // ---- DDC self-learning: numbers this school has already used ----
  public getUsedDdc = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchoolId(event, callback);
      if (!schoolId) return;
      const q = event.queryStringParameters?.q;
      const used = await workService.suggestUsedDdc(schoolId, q);
      ResponseBuilder.ok({ used }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new LookupHandler();
export const listLookups = handler.listLookups;
export const createLookup = handler.createLookup;
export const updateLookup = handler.updateLookup;
export const deleteLookup = handler.deleteLookup;
export const getDdc = handler.getDdc;
export const getDdcByCode = handler.getDdcByCode;
export const normalizeAuthor = handler.normalizeAuthor;
export const generateCallNo = handler.generateCallNo;
export const isbnLookup = handler.isbnLookup;
export const getKeywords = handler.getKeywords;
export const getUsedDdc = handler.getUsedDdc;
export const getStaticLookups = handler.getStaticLookups;
