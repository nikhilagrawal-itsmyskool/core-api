import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { ACTIONS } from "../../shared/lib/authz-policy";
import { resolveSchool, resolveEmployee, parseBody, requireParam, callerIsExamOverride } from "./handler-util";
import { getCurrentAcademicYearId } from "./examination-common";
import { reportService } from "./report-service";

// Report-card marks + co-scholastic entry. /me/* is employee-scoped (subject/class teachers +
// the exam-incharge, who bypasses the teacher checks via override). /report/* is guarded.
class ReportHandler {
  private ay(event: ApiEvent, schoolId: string): Promise<string | null> {
    const q = (event.queryStringParameters && event.queryStringParameters.ay) || undefined;
    return q ? Promise.resolve(q) : getCurrentAcademicYearId(schoolId);
  }
  private term(event: ApiEvent): number {
    const t = Number(requireParamRaw(event, "term"));
    return t === 2 ? 2 : 1;
  }

  // GET /me/report/subjects — the (class, subject) pairs this teacher may enter.
  public getMySubjects = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const ay = await this.ay(event, emp.schoolId);
      if (!ay) { ResponseBuilder.ok({ subjects: [] }, callback); return; }
      ResponseBuilder.ok({ academicYearId: ay, currentTerm: await reportService.currentTerm(emp.schoolId, ay), subjects: await reportService.mySubjects(emp.schoolId, ay, emp.employeeId) }, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /me/report/marks/{classId}/{subjectCode}/{term}
  public getMyMarks = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const classId = requireParam(event, "classId", callback);
      const subjectCode = requireParam(event, "subjectCode", callback);
      if (!classId || !subjectCode) return;
      const term = this.term(event);
      const ay = await this.ay(event, emp.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      if (!(await reportService.canEnterSubject(emp.schoolId, ay, classId, subjectCode, emp.employeeId, callerIsExamOverride(event)))) {
        ResponseBuilder.forbidden(ErrorCode.MissingPermission, "You are not the assigned teacher for this subject", callback); return;
      }
      ResponseBuilder.ok(await reportService.marksGrid(emp.schoolId, ay, classId, subjectCode, term, emp.employeeId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /me/report/marks/{classId}/{subjectCode}/{term} { entries:[{studentId, marks:{code:val}}] }
  public saveMyMarks = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const classId = requireParam(event, "classId", callback);
      const subjectCode = requireParam(event, "subjectCode", callback);
      if (!classId || !subjectCode) return;
      const term = this.term(event);
      const ay = await this.ay(event, emp.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ entries: any[] }>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await reportService.saveMarks(emp.schoolId, ay, classId, subjectCode, term, body.entries || [], emp.employeeId, callerIsExamOverride(event)), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /me/report/classes — classes the caller may enter co-scholastic for.
  public getMyClasses = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const ay = await this.ay(event, emp.schoolId);
      if (!ay) { ResponseBuilder.ok({ classes: [] }, callback); return; }
      ResponseBuilder.ok({ academicYearId: ay, currentTerm: await reportService.currentTerm(emp.schoolId, ay), classes: await reportService.myReportClasses(emp.schoolId, ay, emp.employeeId, callerIsExamOverride(event)) }, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /me/report/coscholastic/{classId}/{term}
  public getMyCoscholastic = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const term = this.term(event);
      const ay = await this.ay(event, emp.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      if (!callerIsExamOverride(event) && !(await reportService.isClassTeacher(emp.schoolId, ay, classId, emp.employeeId))) {
        ResponseBuilder.forbidden(ErrorCode.MissingPermission, "Only the class teacher can enter co-scholastic grades", callback); return;
      }
      ResponseBuilder.ok(await reportService.coscholasticGrid(emp.schoolId, ay, classId, term, emp.employeeId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /me/report/coscholastic/{classId}/{term} { entries:[{studentId, grades:{areaId:grade}, attendancePresent, attendanceTotal, house, remark}] }
  public saveMyCoscholastic = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const term = this.term(event);
      const ay = await this.ay(event, emp.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ entries: any[] }>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await reportService.saveCoscholastic(emp.schoolId, ay, classId, term, body.entries || [], emp.employeeId, callerIsExamOverride(event)), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /report/progress/{term} — exam-incharge dashboard (guarded exam.manage).
  public getProgress = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const term = this.term(event);
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.ok({ term, classes: [], pctEntered: 0, pendingSubjects: 0 }, callback); return; }
      ResponseBuilder.ok({ ...(await reportService.progress(auth.schoolId, ay, term, auth.userId)), currentTerm: await reportService.currentTerm(auth.schoolId, ay) }, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /report/mapping/{classId} — per-class subject → teacher mapping (guarded).
  public getSubjectMapping = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      ResponseBuilder.ok(await reportService.subjectMapping(auth.schoolId, ay, classId, auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /report/mapping/{classId} { subjectCode, teacherId } — assign/clear the subject teacher.
  // subjectCode is in the body (not the path) so GET+POST share one API-Gateway resource.
  public assignSubjectTeacher = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ subjectCode?: string; teacherId?: string }>(event, callback);
      if (!body) return;
      const subjectCode = (body.subjectCode || "").trim();
      if (!subjectCode) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "subjectCode is required", callback); return; }
      ResponseBuilder.ok(await reportService.assignSubjectTeacher(auth.schoolId, ay, classId, subjectCode, body.teacherId || "", auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /report/cards/{classId}/{term} — all data to render a class's report cards for a term.
  public getReportCards = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const term = this.term(event);
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      ResponseBuilder.ok(await reportService.reportCards(auth.schoolId, ay, classId, term, auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /report/cards/{classId}/{term} { studentIds } — record a print (count + timestamp).
  public recordReportPrint = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const term = this.term(event);
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ studentIds: string[] }>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await reportService.recordPrint(auth.schoolId, ay, classId, term, body.studentIds || [], auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /report/scheme/{band} — the editable format (components/subjects/areas/scale) for a band.
  public getScheme = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const band = requireParam(event, "band", callback);
      if (!band) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      ResponseBuilder.ok(await reportService.getScheme(auth.schoolId, ay, band, auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /report/scheme/{band} — save edited labels/maxes/areas/scale.
  public saveScheme = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const band = requireParam(event, "band", callback);
      if (!band) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<any>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await reportService.saveScheme(auth.schoolId, ay, band, body, auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /report/config — { term2StartsOn, currentTerm }
  public getReportConfig = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.ok({ term2StartsOn: null, currentTerm: 1 }, callback); return; }
      ResponseBuilder.ok({ ...(await reportService.getConfig(auth.schoolId, ay)), currentTerm: await reportService.currentTerm(auth.schoolId, ay) }, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /report/config { term2StartsOn }
  public setReportConfig = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ term2StartsOn?: string | null }>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await reportService.setConfig(auth.schoolId, ay, body.term2StartsOn || null, auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

// requireParam echoes an error to the callback on miss; term has a sane default so read it raw.
function requireParamRaw(event: ApiEvent, name: string): string | undefined {
  return (event.pathParameters && event.pathParameters[name]) || undefined;
}

const h = new ReportHandler();

// All /me/report/* routes are served by ONE Lambda that dispatches on method+resource — this
// keeps the module under CloudFormation's 500-resource-per-stack cap (one function, many http
// events, instead of one function per route). /report/* stays its own guarded function.
const ME_ROUTES: Record<string, any> = {
  "GET /me/report/subjects": h.getMySubjects,
  "GET /me/report/classes": h.getMyClasses,
  "GET /me/report/marks/{classId}/{subjectCode}/{term}": h.getMyMarks,
  "POST /me/report/marks/{classId}/{subjectCode}/{term}": h.saveMyMarks,
  "GET /me/report/coscholastic/{classId}/{term}": h.getMyCoscholastic,
  "POST /me/report/coscholastic/{classId}/{term}": h.saveMyCoscholastic,
};
// Resolve "METHOD /path" from an event, tolerating serverless-offline's /examination prefix.
function routeKey(event: ApiEvent): string {
  const anyEvent = event as any;
  const method = event.httpMethod || anyEvent.requestContext?.http?.method;
  const resource = (event.resource || anyEvent.requestContext?.resourcePath || anyEvent.requestContext?.http?.path || "").replace(/^\/?examination/, "");
  return `${method} ${resource}`;
}
function dispatch(routes: Record<string, any>) {
  return async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    const fn = routes[routeKey(event)];
    if (!fn) { ResponseBuilder.notFound(ErrorCode.GeneralError, "Not found", callback); return; }
    return fn(event, ctx, callback);
  };
}

export const reportMe = dispatch(ME_ROUTES);

// /report — the exam-incharge surface (dashboard + subject mapping read/write). One guarded
// dispatcher (exam.manage) so it stays a single Lambda under CloudFormation's 500-resource cap.
export const reportAdmin = guard(ACTIONS.EXAM_MANAGE, dispatch({
  "GET /report/progress/{term}": h.getProgress,
  "GET /report/mapping/{classId}": h.getSubjectMapping,
  "POST /report/mapping/{classId}": h.assignSubjectTeacher,
  "GET /report/cards/{classId}/{term}": h.getReportCards,
  "POST /report/cards/{classId}/{term}": h.recordReportPrint,
  "GET /report/scheme/{band}": h.getScheme,
  "POST /report/scheme/{band}": h.saveScheme,
  "GET /report/config": h.getReportConfig,
  "POST /report/config": h.setReportConfig,
}));
