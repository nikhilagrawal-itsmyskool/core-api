import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard, requireAction } from "../auth/authz";
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
      const body = parseBody<{ entries: any[] }>(event, callback); // each entry may carry per-student denominators for scalable columns
      if (!body) return;
      ResponseBuilder.ok(await reportService.saveMarks(emp.schoolId, ay, classId, subjectCode, term, body.entries || [], emp.employeeId, callerIsExamOverride(event)), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /me/report/submit-marks { classId, subjectCode, term } — validate complete + mark submitted.
  public submitMyMarks = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const ay = await this.ay(event, emp.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ classId?: string; subjectCode?: string; term?: number }>(event, callback);
      if (!body) return;
      const classId = (body.classId || "").trim(); const subjectCode = (body.subjectCode || "").trim();
      if (!classId || !subjectCode) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "classId and subjectCode are required", callback); return; }
      const term = body.term === 2 ? 2 : 1;
      ResponseBuilder.ok(await reportService.submitMarks(emp.schoolId, ay, classId, subjectCode, term, emp.employeeId, callerIsExamOverride(event)), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /me/report/submit-coscholastic { classId, term } — validate complete + mark submitted.
  public submitMyCoscholastic = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const ay = await this.ay(event, emp.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ classId?: string; term?: number }>(event, callback);
      if (!body) return;
      const classId = (body.classId || "").trim();
      if (!classId) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "classId is required", callback); return; }
      const term = body.term === 2 ? 2 : 1;
      ResponseBuilder.ok(await reportService.submitCoscholastic(emp.schoolId, ay, classId, term, emp.employeeId, callerIsExamOverride(event)), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /report/lock { classId, term, target, locked } — admin lock/unlock a subject, co-scholastic
  // (target='__cosch__'), or the whole class (target='__all__'). Guarded exam.manage by the dispatcher.
  public setLock = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ classId?: string; term?: number; target?: string; locked?: boolean }>(event, callback);
      if (!body) return;
      const classId = (body.classId || "").trim(); const target = (body.target || "").trim();
      if (!classId || !target) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "classId and target are required", callback); return; }
      const term = body.term === 2 ? 2 : 1;
      ResponseBuilder.ok(await reportService.setLock(auth.schoolId, ay, classId, term, target, !!body.locked, auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /report/exclude-class { classId, excluded } — exclude/include a class from the exam module.
  public setClassExcluded = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ classId?: string; excluded?: boolean }>(event, callback);
      if (!body) return;
      const classId = (body.classId || "").trim();
      if (!classId) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "classId is required", callback); return; }
      ResponseBuilder.ok(await reportService.setClassExcluded(auth.schoolId, ay, classId, !!body.excluded, auth.userId), callback);
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
      // Co-scholastic is a class-teacher task — list ONLY the caller's own class-teacher classes,
      // even for the exam-incharge (who prints report cards via /report/classes instead).
      ResponseBuilder.ok({ academicYearId: ay, currentTerm: await reportService.currentTerm(emp.schoolId, ay), classes: await reportService.myReportClasses(emp.schoolId, ay, emp.employeeId, false) }, callback);
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
      if (!callerIsExamOverride(event) && !(await reportService.canEnterCoscholastic(emp.schoolId, ay, classId, emp.employeeId))) {
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

  // GET /report/coscholastic-progress/{term} — per-class co-scholastic completion (incharge tab).
  public getCoscholasticProgress = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const term = this.term(event);
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.ok({ term, classes: [], pctEntered: 0, pendingClasses: 0 }, callback); return; }
      ResponseBuilder.ok({ ...(await reportService.coscholasticProgress(auth.schoolId, ay, term, auth.userId)), currentTerm: await reportService.currentTerm(auth.schoolId, ay) }, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /report/mapping/{classId} — per-class subject → teacher mapping (guarded).
  public getSubjectMapping = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, ACTIONS.SUBJECT_MAPPING_MANAGE, callback)) return; // admin/god only, not exam-incharge
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      ResponseBuilder.ok(await reportService.subjectMapping(auth.schoolId, ay, classId, auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /report/mapping/{classId} { subjectCode, teacherId, action:'add'|'remove' } — add/remove an
  // extra subject teacher (additive on top of the syllabus teacher). Body-keyed so GET+POST share a resource.
  public assignSubjectTeacher = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, ACTIONS.SUBJECT_MAPPING_MANAGE, callback)) return; // admin/god only, not exam-incharge
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ subjectCode?: string; teacherId?: string; action?: string }>(event, callback);
      if (!body) return;
      const subjectCode = (body.subjectCode || "").trim();
      if (!subjectCode) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "subjectCode is required", callback); return; }
      ResponseBuilder.ok(await reportService.setSubjectTeacher(auth.schoolId, ay, classId, subjectCode, body.teacherId || "", body.action || "add", auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /report/class-teachers/{classId} — primary (timetable) + secondary class teachers.
  public getClassTeachers = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, ACTIONS.SUBJECT_MAPPING_MANAGE, callback)) return; // admin/god only
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      ResponseBuilder.ok(await reportService.classTeacherMapping(auth.schoolId, ay, classId, auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /report/class-teachers/{classId} { teacherId, allSubjects, action:'add'|'remove' }
  public setClassTeacher = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!requireAction(event, ACTIONS.SUBJECT_MAPPING_MANAGE, callback)) return; // admin/god only
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ teacherId?: string; allSubjects?: boolean; action?: string }>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await reportService.setClassTeacher(auth.schoolId, ay, classId, body.teacherId || "", !!body.allSubjects, body.action || "add", auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /me/report/cards/{classId}/{term} — a class teacher views their class's report cards (to OK them).
  public getMyReportCards = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const classId = requireParam(event, "classId", callback);
      if (!classId) return;
      const term = this.term(event);
      const ay = await this.ay(event, emp.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      if (!callerIsExamOverride(event) && !(await reportService.canEnterCoscholastic(emp.schoolId, ay, classId, emp.employeeId))) {
        ResponseBuilder.forbidden(ErrorCode.MissingPermission, "Only the class teacher can view this class's report cards", callback); return;
      }
      ResponseBuilder.ok(await reportService.reportCards(emp.schoolId, ay, classId, term, emp.employeeId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /me/report/approve { classId, term, studentIds, approve } — class-teacher sign-off.
  public approveReportCards = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const ay = await this.ay(event, emp.schoolId);
      if (!ay) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "No academic year", callback); return; }
      const body = parseBody<{ classId?: string; term?: number; studentIds?: string[]; approve?: boolean }>(event, callback);
      if (!body) return;
      const classId = (body.classId || "").trim();
      if (!classId) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "classId is required", callback); return; }
      const term = body.term === 2 ? 2 : 1;
      ResponseBuilder.ok(await reportService.approveReportCards(emp.schoolId, ay, classId, term, body.studentIds || [], body.approve !== false, emp.employeeId, callerIsExamOverride(event)), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /verify/report/{token} — PUBLIC scan-to-verify (no auth). token from the card's QR URL.
  public verifyReport = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const token = requireParam(event, "token", callback);
      if (!token) return;
      ResponseBuilder.ok(await reportService.verifyReportCard(token), callback);
    } catch { ResponseBuilder.ok({ found: false }, callback); }
  };

  // GET /me/report/remark-templates — class-teacher remark suggestions (any teacher, for the picker).
  public getMyRemarkTemplates = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      ResponseBuilder.ok(await reportService.remarkTemplates(emp.schoolId, emp.employeeId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /report/remark-templates — the editable library (exam.manage).
  public getRemarkTemplates = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      ResponseBuilder.ok(await reportService.remarkTemplates(auth.schoolId, auth.userId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /report/remark-templates { uuid?, category, text, sortOrder, action:'save'|'delete' }
  public postRemarkTemplate = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<{ uuid?: string; category?: string; text?: string; sortOrder?: number; action?: string }>(event, callback);
      if (!body) return;
      if (body.action === "delete") {
        if (!body.uuid) { ResponseBuilder.badRequest(ErrorCode.BusinessError, "uuid is required to delete", callback); return; }
        ResponseBuilder.ok(await reportService.deleteRemarkTemplate(auth.schoolId, body.uuid, auth.userId), callback);
      } else {
        ResponseBuilder.ok(await reportService.saveRemarkTemplate(auth.schoolId, body, auth.userId), callback);
      }
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /report/classes — every class that has a report scheme (for the Report Cards screen).
  // exam.manage (incharge/admin/god) — not scoped to class-teacher assignment.
  public getReportClasses = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const ay = await this.ay(event, auth.schoolId);
      if (!ay) { ResponseBuilder.ok({ classes: [], currentTerm: 1 }, callback); return; }
      ResponseBuilder.ok({ academicYearId: ay, currentTerm: await reportService.currentTerm(auth.schoolId, ay), classes: await reportService.schemeClasses(auth.schoolId, ay, auth.userId) }, callback);
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

  // GET /report/photo/{studentId} — one student's latest photo as a data URI (print pass fetches
  // these per pre-primary student, then resizes client-side; kept off the whole-class payload).
  public getReportPhoto = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const studentId = requireParam(event, "studentId", callback);
      if (!studentId) return;
      ResponseBuilder.ok(await reportService.reportPhoto(auth.schoolId, studentId), callback);
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
      const body = parseBody<{ term2StartsOn?: string | null; remarkRequiredFinal?: boolean }>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await reportService.setConfig(auth.schoolId, ay, { term2StartsOn: body.term2StartsOn || null, remarkRequiredFinal: !!body.remarkRequiredFinal }, auth.userId), callback);
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
  "GET /me/report/remark-templates": h.getMyRemarkTemplates,
  "GET /me/report/cards/{classId}/{term}": h.getMyReportCards,
  "POST /me/report/approve": h.approveReportCards,
  "POST /me/report/submit-marks": h.submitMyMarks,
  "POST /me/report/submit-coscholastic": h.submitMyCoscholastic,
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

// PUBLIC — authorizer-exempt (see serverless.yml authorizerExtraExempt). Mirrors the fee-receipt
// public verify. Ungated: returns only the safe, celebratory summary already printed on the card.
export const verifyReport = h.verifyReport;

// /report — the exam-incharge surface (dashboard + subject mapping read/write). One guarded
// dispatcher (exam.manage) so it stays a single Lambda under CloudFormation's 500-resource cap.
export const reportAdmin = guard(ACTIONS.EXAM_MANAGE, dispatch({
  "GET /report/progress/{term}": h.getProgress,
  "GET /report/coscholastic-progress/{term}": h.getCoscholasticProgress,
  "GET /report/mapping/{classId}": h.getSubjectMapping,
  "POST /report/mapping/{classId}": h.assignSubjectTeacher,
  "GET /report/class-teachers/{classId}": h.getClassTeachers,
  "POST /report/class-teachers/{classId}": h.setClassTeacher,
  "GET /report/remark-templates": h.getRemarkTemplates,
  "POST /report/remark-templates": h.postRemarkTemplate,
  "POST /report/lock": h.setLock,
  "POST /report/exclude-class": h.setClassExcluded,
  "GET /report/classes": h.getReportClasses,
  "GET /report/cards/{classId}/{term}": h.getReportCards,
  "POST /report/cards/{classId}/{term}": h.recordReportPrint,
  "GET /report/photo/{studentId}": h.getReportPhoto,
  "GET /report/scheme/{band}": h.getScheme,
  "POST /report/scheme/{band}": h.saveScheme,
  "GET /report/config": h.getReportConfig,
  "POST /report/config": h.setReportConfig,
}));
