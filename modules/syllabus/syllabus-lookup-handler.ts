import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { resolveSchool } from "./handler-util";
import { listBaseClasses, listStreams } from "./syllabus-common";
import { parseGrade } from "./syllabus-util";
import {
  DOC_TYPES,
  ENTRY_TYPES,
  EXAMS,
  LAYOUTS,
  MONTHS,
  PROGRESS_STATUSES,
  TERMS,
} from "./syllabus-constants";

class SyllabusLookupHandler {
  // GET /lookups — all dropdown catalogs for the planner UI.
  public getLookups = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      ResponseBuilder.ok(
        {
          months: MONTHS,
          entryTypes: ENTRY_TYPES,
          terms: TERMS,
          layouts: LAYOUTS,
          progressStatuses: PROGRESS_STATUSES,
          exams: EXAMS,
          docTypes: DOC_TYPES,
        },
        callback,
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /grades — distinct grades derived from base class (section) names, so the
  // admin can pick a grade to author a plan for. Each grade lists its base
  // sections only (stream-child rows like "XI-A (Science)" are excluded — stream
  // is a filter on the subject, and teachers/coverage attach to base sections).
  public getGrades = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const classes = await listBaseClasses(ctx.schoolId);
      const byGrade = new Map<
        string,
        { grade: string; sections: { classId: string; className: string }[] }
      >();
      for (const c of classes) {
        const grade = parseGrade(c.name);
        const key = grade.toLowerCase();
        if (!byGrade.has(key)) byGrade.set(key, { grade, sections: [] });
        byGrade.get(key)!.sections.push({ classId: c.uuid, className: c.name });
      }
      ResponseBuilder.ok([...byGrade.values()], callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /streams — the school's stream catalog (class_stream), e.g.
  // [{ code: 'SCI', name: 'Science' }, …], for the stream picker when authoring
  // subjects/plans for senior grades. Empty for schools with no streams.
  public getStreams = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const streams = await listStreams(ctx.schoolId);
      ResponseBuilder.ok(streams, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SyllabusLookupHandler();
export const getLookups = handler.getLookups;
export const getGrades = handler.getGrades;
export const getStreams = handler.getStreams;
