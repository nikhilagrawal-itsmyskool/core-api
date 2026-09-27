import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { resolveSchool } from "./handler-util";
import { requireAction } from "../auth/authz";
import { listBaseClasses } from "./programmes-common";
import { parseGrade } from "./programmes-util";
import { programmeService } from "./programme-service";
import { MONTHS, WORKFLOW_STATUSES, ASSESSMENT_BANDS } from "./programmes-constants";

class ProgrammesLookupHandler {
  // GET /lookups — dropdown catalogs + the school's programmes.
  public getLookups = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, "programme.view", callback)) return;
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const programmes = await programmeService.list(ctx.schoolId);
      ResponseBuilder.ok(
        {
          programmes: programmes.map((p) => ({ code: p.code, name: p.name })),
          months: MONTHS,
          workflowStatuses: WORKFLOW_STATUSES,
          assessmentBands: ASSESSMENT_BANDS,
        },
        callback,
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /grades — distinct grades derived from base class (section) names, each
  // listing its base sections. Same derivation as the syllabus module.
  public getGrades = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, "programme.view", callback)) return;
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
}

const handler = new ProgrammesLookupHandler();
export const getLookups = handler.getLookups;
export const getGrades = handler.getGrades;
