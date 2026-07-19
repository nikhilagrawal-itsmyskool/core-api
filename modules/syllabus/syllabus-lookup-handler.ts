import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { resolveSchool } from "./handler-util";
import { listClasses } from "./syllabus-common";
import { parseGrade } from "./syllabus-util";
import {
  ENTRY_TYPES,
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
        },
        callback,
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /grades — distinct grades derived from class (section) names, so the
  // admin can pick a grade to author a plan for. Each grade lists its sections.
  public getGrades = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const classes = await listClasses(ctx.schoolId);
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
}

const handler = new SyllabusLookupHandler();
export const getLookups = handler.getLookups;
export const getGrades = handler.getGrades;
