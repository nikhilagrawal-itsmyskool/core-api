import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { ACTIONS } from "../../shared/lib/authz-policy";
import { resolveSchool, parseBody, requireParam, callerHasRole } from "./handler-util";
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
