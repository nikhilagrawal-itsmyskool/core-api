import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { getCurrentAcademicYearId, isValidDate } from "./academic-calendar-common";
import { academicCalendarService } from "./academic-calendar-service";
import {
  AddEntryRequest,
  CreateTypeRequest,
  SetHolidayRequest,
  UpdateEntryRequest,
  UpdateTypeRequest,
} from "./academic-calendar-interfaces";

const MAX_RANGE_DAYS = 400;

function badDate(callback: ApiCallback, field = "date"): void {
  ResponseBuilder.badRequest(ErrorCode.InvalidInput, `${field} (YYYY-MM-DD) is required`, callback);
}

async function resolveAy(schoolId: string, provided?: string): Promise<string | null> {
  return provided || (await getCurrentAcademicYearId(schoolId));
}

class AcademicCalendarHandler {
  // ── Types ──────────────────────────────────────────────────────────────────

  // GET /academic-calendar/types
  public listTypes = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const rows = await academicCalendarService.listTypes(auth.schoolId, auth.userId);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /academic-calendar/types { name, code?, sortOrder? }
  public createType = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<CreateTypeRequest>(event, callback);
      if (!body) return;
      const result = await academicCalendarService.createType(auth.schoolId, body, auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /academic-calendar/types/{id} { name?, sortOrder? }
  public updateType = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<UpdateTypeRequest>(event, callback);
      if (!body) return;
      const result = await academicCalendarService.updateType(auth.schoolId, id, body, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Type not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /academic-calendar/types/{id}
  public deleteType = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const ok = await academicCalendarService.deleteType(auth.schoolId, id, auth.userId);
      if (!ok) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Type not found", callback);
      ResponseBuilder.ok({ deleted: true }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ── Calendar grid ────────────────────────────────────────────────────────

  // GET /academic-calendar/calendar?from=&to=&academicYearId=
  // Also accepts month=YYYY-MM as a shortcut for a whole month.
  public getCalendar = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      let from = q.from;
      let to = q.to;
      if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
        from = `${q.month}-01`;
        to = lastDayOfMonth(q.month);
      }
      if (!isValidDate(from)) return badDate(callback, "from");
      if (!isValidDate(to)) return badDate(callback, "to");
      if (daySpan(from!, to!) > MAX_RANGE_DAYS) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Range too large (max ${MAX_RANGE_DAYS} days)`, callback);
      }
      const ay = await resolveAy(auth.schoolId, q.academicYearId);
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      const result = await academicCalendarService.getCalendar(auth.schoolId, ay, from!, to!, auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ── Entries ──────────────────────────────────────────────────────────────

  // POST /academic-calendar/entries { entryDate, typeId|typeCode, value, detail?, endDate?, academicYearId? }
  public addEntry = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<AddEntryRequest>(event, callback);
      if (!body) return;
      if (!isValidDate(body.entryDate)) return badDate(callback, "entryDate");
      if (body.endDate && !isValidDate(body.endDate)) return badDate(callback, "endDate");
      const ay = await resolveAy(auth.schoolId, body.academicYearId);
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      const result = await academicCalendarService.addEntry(auth.schoolId, ay, body, auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /academic-calendar/entries/{id}
  public updateEntry = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<UpdateEntryRequest>(event, callback);
      if (!body) return;
      if (body.endDate && !isValidDate(body.endDate)) return badDate(callback, "endDate");
      const result = await academicCalendarService.updateEntry(auth.schoolId, id, body, auth.userId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Entry not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /academic-calendar/entries/{id}
  public deleteEntry = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const ok = await academicCalendarService.deleteEntry(auth.schoolId, id, auth.userId);
      if (!ok) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Entry not found", callback);
      ResponseBuilder.ok({ deleted: true }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ── Holidays ─────────────────────────────────────────────────────────────

  // GET /academic-calendar/holidays?from=&to=&academicYearId=
  public listHolidays = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      if (!isValidDate(q.from)) return badDate(callback, "from");
      if (!isValidDate(q.to)) return badDate(callback, "to");
      const ay = await resolveAy(auth.schoolId, q.academicYearId);
      if (!ay) return ResponseBuilder.ok([], callback);
      const rows = await academicCalendarService.listHolidays(auth.schoolId, ay, q.from!, q.to!);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /academic-calendar/holidays { holidayDate, name?, kind?, academicYearId? }
  public setHoliday = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<SetHolidayRequest>(event, callback);
      if (!body) return;
      if (!isValidDate(body.holidayDate)) return badDate(callback, "holidayDate");
      const ay = await resolveAy(auth.schoolId, body.academicYearId);
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      const result = await academicCalendarService.setHoliday(auth.schoolId, ay, body, auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ── Settings (weekly-off) + non-teaching resolver ─────────────────────────

  // GET /academic-calendar/settings?academicYearId=
  public getSettings = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const ay = await resolveAy(auth.schoolId, q.academicYearId);
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      const weeklyOff = await academicCalendarService.getWeeklyOff(auth.schoolId, ay);
      ResponseBuilder.ok({ academicYearId: ay, weeklyOff }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /academic-calendar/settings { weeklyOff: number[], academicYearId? }
  public setSettings = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<{ weeklyOff?: number[]; academicYearId?: string }>(event, callback);
      if (!body) return;
      if (!Array.isArray(body.weeklyOff)) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "weeklyOff must be an array of weekday numbers (0=Sun..6=Sat)", callback);
      const ay = await resolveAy(auth.schoolId, body.academicYearId);
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      const weeklyOff = await academicCalendarService.setWeeklyOff(auth.schoolId, ay, body.weeklyOff, auth.userId);
      ResponseBuilder.ok({ academicYearId: ay, weeklyOff }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /academic-calendar/non-teaching?from=&to=&academicYearId=
  public getNonTeaching = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      if (!isValidDate(q.from)) return badDate(callback, "from");
      if (!isValidDate(q.to)) return badDate(callback, "to");
      const ay = await resolveAy(auth.schoolId, q.academicYearId);
      if (!ay) return ResponseBuilder.ok([], callback);
      const rows = await academicCalendarService.nonTeachingDates(auth.schoolId, ay, q.from!, q.to!);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ── Import (xlsx) ──────────────────────────────────────────────────────────

  // POST /academic-calendar/import/preview { fileBase64, academicYearId?, includeAcademicActivities?, fileName? }
  public importPreview = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      if (!body.fileBase64) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "fileBase64 is required", callback);
      const ay = await resolveAy(auth.schoolId, body.academicYearId);
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      const buffer = Buffer.from(body.fileBase64, "base64");
      const result = await academicCalendarService.importPreview(auth.schoolId, ay, buffer,
        { includeAcademicActivities: !!body.includeAcademicActivities, fileName: body.fileName }, auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /academic-calendar/import/apply { fileBase64, academicYearId?, includeAcademicActivities?, replace? }
  public importApply = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      if (!body.fileBase64) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, "fileBase64 is required", callback);
      const ay = await resolveAy(auth.schoolId, body.academicYearId);
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      const buffer = Buffer.from(body.fileBase64, "base64");
      const result = await academicCalendarService.importApply(auth.schoolId, ay, buffer,
        { includeAcademicActivities: !!body.includeAcademicActivities, replace: !!body.replace }, auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /academic-calendar/holidays/{id}
  public deleteHoliday = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const ok = await academicCalendarService.deleteHoliday(auth.schoolId, id, auth.userId);
      if (!ok) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Holiday not found", callback);
      ResponseBuilder.ok({ deleted: true }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

function daySpan(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86400000) + 1;
}
function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  return d.toISOString().slice(0, 10);
}

const h = new AcademicCalendarHandler();
export const listTypes = h.listTypes;
export const createType = h.createType;
export const updateType = h.updateType;
export const deleteType = h.deleteType;
export const getCalendar = h.getCalendar;
export const addEntry = h.addEntry;
export const updateEntry = h.updateEntry;
export const deleteEntry = h.deleteEntry;
export const listHolidays = h.listHolidays;
export const setHoliday = h.setHoliday;
export const deleteHoliday = h.deleteHoliday;
export const importPreview = h.importPreview;
export const importApply = h.importApply;
export const getSettings = h.getSettings;
export const setSettings = h.setSettings;
export const getNonTeaching = h.getNonTeaching;
