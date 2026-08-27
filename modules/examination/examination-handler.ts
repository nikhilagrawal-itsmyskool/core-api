import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { ACTIONS } from "../../shared/lib/authz-policy";
import { resolveSchool, resolveEmployee, parseBody, requireParam, callerHasRole } from "./handler-util";
import { getCurrentAcademicYearId } from "./examination-common";
import { examinationService } from "./examination-service";
import {
  CreateExamRequest,
  SaveInvigilatorsRequest,
  SavePapersRequest,
  UpdateExamRequest,
} from "./examination-interfaces";

async function resolveAy(schoolId: string, provided?: string): Promise<string | null> {
  return provided || (await getCurrentAcademicYearId(schoolId));
}

class ExaminationHandler {
  // GET /examination/examinations?academicYearId=
  public listExams = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const ay = await resolveAy(auth.schoolId, q.academicYearId);
      if (!ay) return ResponseBuilder.ok([], callback);
      const rows = await examinationService.listExams(auth.schoolId, ay);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /examination/examinations { name, academicYearId?, inchargeEmployeeId?, cardsPerPage? }
  public createExam = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const body = parseBody<CreateExamRequest>(event, callback);
      if (!body) return;
      const ay = await resolveAy(auth.schoolId, body.academicYearId);
      if (!ay) return ResponseBuilder.badRequest(ErrorCode.BusinessError, "No current academic year", callback);
      const result = await examinationService.createExam(auth.schoolId, ay, body, auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examination/examinations/{id}
  public getExam = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const row = await examinationService.getExam(auth.schoolId, id);
      if (!row) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Examination not found", callback);
      ResponseBuilder.ok(row, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PATCH /examination/examinations/{id}
  public updateExam = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<UpdateExamRequest>(event, callback);
      if (!body) return;
      const isGod = callerHasRole(event, "god");
      const result = await examinationService.updateExam(auth.schoolId, id, body, auth.userId, isGod);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Examination not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /examination/examinations/{id}
  public deleteExam = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const ok = await examinationService.deleteExam(auth.schoolId, id, auth.userId);
      if (!ok) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Examination not found", callback);
      ResponseBuilder.ok({ deleted: true }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examination/examinations/{id}/grid
  public getGrid = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await examinationService.getGrid(auth.schoolId, id);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /examination/examinations/{id}/papers { papers: [{ grade, examDate, subjectLabel }] }
  public savePapers = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<SavePapersRequest>(event, callback);
      if (!body) return;
      const result = await examinationService.savePapers(auth.schoolId, id, body.papers || [], auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examination/examinations/{id}/invigilators
  public getInvigilators = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await examinationService.getInvigilators(auth.schoolId, id);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /examination/examinations/{id}/invigilators { assignments: [{ examDate, sectionClassId, employeeId }] }
  public saveInvigilators = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<SaveInvigilatorsRequest>(event, callback);
      if (!body) return;
      const result = await examinationService.saveInvigilators(auth.schoolId, id, body.assignments || [], auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /examinations/{id}/papers/{grade} — save one grade's papers (PWA)
  public savePapersForGrade = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      const grade = requireParam(event, "grade", callback);
      if (!id || !grade) return;
      const body = parseBody<{ papers: any[] }>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await examinationService.savePapersForGrade(auth.schoolId, id, grade, body.papers || [], auth.userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /examinations/{id}/invigilators/date/{date} — save one day's assignments (PWA)
  public saveInvigilatorsForDate = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      const date = requireParam(event, "date", callback);
      if (!id || !date) return;
      const body = parseBody<{ assignments: any[] }>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await examinationService.saveInvigilatorsForDate(auth.schoolId, id, date, body.assignments || [], auth.userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ── Phase 2: roster/dues, admit cards, printing, overrides, branding, verify ────

  // GET /examinations/{id}/classes/{sectionId}/roster
  public getRoster = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      const sectionId = requireParam(event, "sectionId", callback);
      if (!id || !sectionId) return;
      const result = await examinationService.roster(auth.schoolId, id, sectionId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examinations/{id}/classes/{sectionId}/print-preview?cardsPerPage=
  public getPrintPreview = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      const sectionId = requireParam(event, "sectionId", callback);
      if (!id || !sectionId) return;
      const per = Number((event.queryStringParameters || {}).cardsPerPage) || undefined;
      const result = await examinationService.printPreview(auth.schoolId, id, sectionId, per);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examinations/{id}/classes/{sectionId}/admit-cards?studentIds=a,b
  public getAdmitCards = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      const sectionId = requireParam(event, "sectionId", callback);
      if (!id || !sectionId) return;
      const raw = (event.queryStringParameters || {}).studentIds;
      const only = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const result = await examinationService.admitCards(auth.schoolId, id, sectionId, auth.userId, only);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /examinations/{id}/classes/{sectionId}/print { cardsPerPage, studentCount, pageCount, reason?, note? }
  public recordPrint = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      const sectionId = requireParam(event, "sectionId", callback);
      if (!id || !sectionId) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      const result = await examinationService.recordPrint(auth.schoolId, id, sectionId, body, auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examinations/{id}/fee-cycles
  public getFeeCycles = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const rows = await examinationService.feeCycles(auth.schoolId, id);
      ResponseBuilder.ok(rows, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examinations/{id}/print-log
  public getPrintLog = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await examinationService.listPrintLog(auth.schoolId, id);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examinations/{id}/dues-overrides
  public listOverrides = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const result = await examinationService.listOverrides(auth.schoolId, id);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /examinations/{id}/dues-overrides { studentIds: [], reason } — GOD ONLY
  public createOverrides = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!callerHasRole(event, "god")) {
        return ResponseBuilder.forbidden(ErrorCode.MissingPermission, "Only a god user can override dues", callback);
      }
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      if (!id) return;
      const body = parseBody<{ studentIds: string[]; reason?: string }>(event, callback);
      if (!body) return;
      const result = await examinationService.createOverrides(auth.schoolId, id, body.studentIds || [], body.reason || "", auth.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // DELETE /examinations/{id}/dues-overrides/{studentId} — GOD ONLY
  public revokeOverride = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      if (!callerHasRole(event, "god")) {
        return ResponseBuilder.forbidden(ErrorCode.MissingPermission, "Only a god user can revoke overrides", callback);
      }
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      const studentId = requireParam(event, "studentId", callback);
      if (!id || !studentId) return;
      const ok = await examinationService.revokeOverride(auth.schoolId, id, studentId, auth.userId);
      if (!ok) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Override not found", callback);
      ResponseBuilder.ok({ revoked: true }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /branding
  public getBranding = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const result = await examinationService.getBranding(auth.schoolId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /branding/{kind}  { imageBase64, mimeType?, fileName? }   kind = logo | stamp
  public setBranding = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const kind = requireParam(event, "kind", callback);
      if (!kind) return;
      const body = parseBody<{ imageBase64: string; mimeType?: string; fileName?: string }>(event, callback);
      if (!body) return;
      const result = await examinationService.setBrandingImage(
        auth.schoolId, kind as any, body.imageBase64, body.mimeType || "image/png", body.fileName || `${kind}.png`, auth.userId,
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /verify/{admitCardId} — staff-authed live admit-card view
  public verifyAdmitCard = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const admitCardId = requireParam(event, "admitCardId", callback);
      if (!admitCardId) return;
      const result = await examinationService.verifyAdmitCard(auth.schoolId, admitCardId);
      if (!result) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Admit card not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ── Phase 3: employee signature + invigilator PWA (/me) ────────────────────────

  // GET /examination/me/signature
  public getMySignature = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      ResponseBuilder.ok(await examinationService.employeeSignature(emp.schoolId, emp.employeeId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /examination/me/signature { imageBase64, mimeType?, fileName? }
  public saveMySignature = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const body = parseBody<{ imageBase64: string; mimeType?: string; fileName?: string }>(event, callback);
      if (!body) return;
      const result = await examinationService.saveEmployeeSignature(emp.schoolId, emp.employeeId, body.imageBase64, body.mimeType || "image/png", body.fileName || "signature.png");
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examination/me/exam/invigilations
  public getMyInvigilations = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      ResponseBuilder.ok(await examinationService.myInvigilations(emp.schoolId, emp.employeeId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examination/me/exam/schedule?academicYearId=  — published exams (any staff)
  public getMySchedule = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const q = event.queryStringParameters || {};
      const ay = q.academicYearId || (await getCurrentAcademicYearId(emp.schoolId));
      if (!ay) return ResponseBuilder.ok([], callback);
      ResponseBuilder.ok(await examinationService.publishedExams(emp.schoolId, ay), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examination/me/exam/schedule/{examId} — read-only datesheet grid (any staff)
  public getMyScheduleGrid = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const examId = requireParam(event, "examId", callback);
      if (!examId) return;
      ResponseBuilder.ok(await examinationService.scheduleGrid(emp.schoolId, examId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /examination/examinations/student/{studentId}/status — Student 360 exam block
  public getStudentExamStatus = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const studentId = requireParam(event, "studentId", callback);
      if (!studentId) return;
      ResponseBuilder.ok(await examinationService.studentExamStatus(auth.schoolId, studentId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Shared /me roster resolver: verifies the caller is the assigned invigilator.
  private async meRosterParams(event: ApiEvent, callback: ApiCallback) {
    const emp = resolveEmployee(event, callback);
    if (!emp) return null;
    const examId = requireParam(event, "examId", callback);
    const paperId = requireParam(event, "paperId", callback);
    const sectionId = requireParam(event, "sectionId", callback);
    if (!examId || !paperId || !sectionId) return null;
    if (!(await examinationService.isMyRoster(examId, paperId, sectionId, emp.employeeId))) {
      ResponseBuilder.forbidden(ErrorCode.MissingPermission, "You are not the assigned invigilator for this roster", callback);
      return null;
    }
    return { emp, examId, paperId, sectionId };
  }

  // GET /examination/me/exam/rosters/{examId}/{paperId}/{sectionId}
  public getMyRoster = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const p = await this.meRosterParams(event, callback);
      if (!p) return;
      ResponseBuilder.ok(await examinationService.attendanceRoster(p.emp.schoolId, p.examId, p.paperId, p.sectionId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /examination/me/exam/rosters/{examId}/{paperId}/{sectionId}/mark { marks: [{studentId,status}] }
  public markMyRoster = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const p = await this.meRosterParams(event, callback);
      if (!p) return;
      const body = parseBody<{ marks: any[] }>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await examinationService.markAttendance(p.emp.schoolId, p.examId, p.paperId, p.sectionId, body.marks || [], p.emp.employeeId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /examination/me/exam/rosters/{examId}/{paperId}/{sectionId}/sign
  public signMyRoster = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const p = await this.meRosterParams(event, callback);
      if (!p) return;
      ResponseBuilder.ok(await examinationService.signRoster(p.emp.schoolId, p.examId, p.paperId, p.sectionId, p.emp.employeeId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ── Admin/incharge: view + sign ANY roster (guarded exam.manage) ───────────────

  // GET /examinations/{id}/rosters/{paperId}/{sectionId}
  public getRosterAdmin = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      const paperId = requireParam(event, "paperId", callback);
      const sectionId = requireParam(event, "sectionId", callback);
      if (!id || !paperId || !sectionId) return;
      ResponseBuilder.ok(await examinationService.attendanceRoster(auth.schoolId, id, paperId, sectionId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /examinations/{id}/rosters/{paperId}/{sectionId}/mark
  public markRosterAdmin = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      const paperId = requireParam(event, "paperId", callback);
      const sectionId = requireParam(event, "sectionId", callback);
      if (!id || !paperId || !sectionId) return;
      const body = parseBody<{ marks: any[] }>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await examinationService.markAttendance(auth.schoolId, id, paperId, sectionId, body.marks || [], auth.userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /examinations/{id}/rosters/{paperId}/{sectionId}/sign
  public signRosterAdmin = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const id = requireParam(event, "id", callback);
      const paperId = requireParam(event, "paperId", callback);
      const sectionId = requireParam(event, "sectionId", callback);
      if (!id || !paperId || !sectionId) return;
      ResponseBuilder.ok(await examinationService.signRoster(auth.schoolId, id, paperId, sectionId, auth.userId), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new ExaminationHandler();

// Export site: every handler is gated by the central RBAC guard. Reads require
// exam.view, writes require exam.manage (god '*' and exam-incharge 'exam.*' both satisfy).
export const listExams = guard(ACTIONS.EXAM_VIEW, h.listExams);
export const createExam = guard(ACTIONS.EXAM_MANAGE, h.createExam);
export const getExam = guard(ACTIONS.EXAM_VIEW, h.getExam);
export const updateExam = guard(ACTIONS.EXAM_MANAGE, h.updateExam);
export const deleteExam = guard(ACTIONS.EXAM_MANAGE, h.deleteExam);
export const getGrid = guard(ACTIONS.EXAM_VIEW, h.getGrid);
export const savePapers = guard(ACTIONS.EXAM_MANAGE, h.savePapers);
export const getInvigilators = guard(ACTIONS.EXAM_VIEW, h.getInvigilators);
export const saveInvigilators = guard(ACTIONS.EXAM_MANAGE, h.saveInvigilators);
export const savePapersForGrade = guard(ACTIONS.EXAM_MANAGE, h.savePapersForGrade);
export const saveInvigilatorsForDate = guard(ACTIONS.EXAM_MANAGE, h.saveInvigilatorsForDate);

// Phase 2
export const getRoster = guard(ACTIONS.EXAM_VIEW, h.getRoster);
export const getPrintPreview = guard(ACTIONS.EXAM_VIEW, h.getPrintPreview);
export const getAdmitCards = guard(ACTIONS.EXAM_MANAGE, h.getAdmitCards);
export const recordPrint = guard(ACTIONS.EXAM_MANAGE, h.recordPrint);
export const getFeeCycles = guard(ACTIONS.EXAM_VIEW, h.getFeeCycles);
export const getPrintLog = guard(ACTIONS.EXAM_VIEW, h.getPrintLog);
export const listOverrides = guard(ACTIONS.EXAM_VIEW, h.listOverrides);
export const createOverrides = guard(ACTIONS.EXAM_MANAGE, h.createOverrides);
export const revokeOverride = guard(ACTIONS.EXAM_MANAGE, h.revokeOverride);
export const getBranding = guard(ACTIONS.EXAM_VIEW, h.getBranding);
export const setBranding = guard(ACTIONS.EXAM_MANAGE, h.setBranding);
export const verifyAdmitCard = guard(ACTIONS.EXAM_VIEW, h.verifyAdmitCard);

// Phase 3 — invigilator PWA (/me): employee-scoped, not role-guarded (JWT still required).
export const getMySignature = h.getMySignature;
export const saveMySignature = h.saveMySignature;
export const getMyInvigilations = h.getMyInvigilations;
export const getMySchedule = h.getMySchedule;
export const getMyScheduleGrid = h.getMyScheduleGrid;
export const getStudentExamStatus = guard(ACTIONS.EXAM_VIEW, h.getStudentExamStatus);
export const getMyRoster = h.getMyRoster;
export const markMyRoster = h.markMyRoster;
export const signMyRoster = h.signMyRoster;
// Phase 3 — admin/incharge sign-any (guarded exam.manage).
export const getRosterAdmin = guard(ACTIONS.EXAM_MANAGE, h.getRosterAdmin);
export const markRosterAdmin = guard(ACTIONS.EXAM_MANAGE, h.markRosterAdmin);
export const signRosterAdmin = guard(ACTIONS.EXAM_MANAGE, h.signRosterAdmin);
