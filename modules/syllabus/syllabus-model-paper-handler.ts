import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveSchool, parseBody, requireParam, guardActiveStudent } from "./handler-util";
import { syllabusModelPaperService } from "./syllabus-model-paper-service";
import { UploadPaperDocRequest } from "./syllabus-interfaces";

class SyllabusModelPaperHandler {
  // GET /model-papers?academicYearId=&grade=&streamCode=&subjectId=&exam=
  public list = async (event: ApiEvent, _c: ApiContext, cb: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, cb);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      const rows = await syllabusModelPaperService.listPapers(ctx.schoolId, {
        academicYearId: q.academicYearId,
        grade: q.grade,
        streamCode: q.streamCode,
        subjectId: q.subjectId,
        exam: q.exam,
      });
      ResponseBuilder.ok(rows, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // POST /model-papers/upload — upload a Word doc (optionally a ready PDF too).
  public upload = async (event: ApiEvent, _c: ApiContext, cb: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, cb);
      if (!ctx) return;
      const body = parseBody<UploadPaperDocRequest>(event, cb);
      if (!body) return;
      const paper = await syllabusModelPaperService.uploadDoc(ctx.schoolId, ctx.userId, body);
      ResponseBuilder.ok(paper, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // PUT /model-papers/{id}/answer-key { released: boolean }
  public setAnswerKey = async (event: ApiEvent, _c: ApiContext, cb: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, cb);
      if (!ctx) return;
      const id = requireParam(event, "id", cb);
      if (!id) return;
      const body = parseBody<{ released: boolean }>(event, cb);
      if (!body) return;
      const ok = await syllabusModelPaperService.setAnswerKeyReleased(ctx.schoolId, ctx.userId, id, !!body.released);
      if (!ok) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Model paper not found", cb);
        return;
      }
      ResponseBuilder.ok({ released: !!body.released }, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // DELETE /model-papers/docs/{id}
  public deleteDoc = async (event: ApiEvent, _c: ApiContext, cb: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, cb);
      if (!ctx) return;
      const id = requireParam(event, "id", cb);
      if (!id) return;
      const ok = await syllabusModelPaperService.deleteDoc(ctx.schoolId, ctx.userId, id);
      if (!ok) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, "Document not found", cb);
        return;
      }
      ResponseBuilder.ok({ message: "Document deleted" }, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // GET /model-papers/docs/{id}/file?format=pdf|docx — staff download (base64).
  public downloadStaff = async (event: ApiEvent, _c: ApiContext, cb: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, cb);
      if (!ctx) return;
      const id = requireParam(event, "id", cb);
      if (!id) return;
      const format = (event.queryStringParameters?.format || "pdf").toLowerCase() === "docx" ? "docx" : "pdf";
      const r = await syllabusModelPaperService.getDocForDownload(ctx.schoolId, id, format, { isStudent: false });
      if (r.status === "forbidden") { ResponseBuilder.forbidden(ErrorCode.MissingPermission, r.message, cb); return; }
      if (r.status === "not_found") { ResponseBuilder.notFound(ErrorCode.InvalidId, r.message, cb); return; }
      ResponseBuilder.ok({ fileName: r.fileName, mimeType: r.mimeType, base64Data: r.base64 }, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // GET /me/papers?subjectId=&exam= — the child's visible papers (student token).
  public myPapers = async (event: ApiEvent, _c: ApiContext, cb: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, cb);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const rows = await syllabusModelPaperService.studentPapers(
        auth.token.school_id,
        auth.activeStudentId,
        q.academicYearId,
        { subjectId: q.subjectId, exam: q.exam },
      );
      ResponseBuilder.ok(rows, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };

  // GET /me/papers/docs/{id}/file — student download (PDF only, answer key gated).
  public downloadStudent = async (event: ApiEvent, _c: ApiContext, cb: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, cb);
      if (!auth) return;
      const id = requireParam(event, "id", cb);
      if (!id) return;
      const r = await syllabusModelPaperService.getDocForDownload(auth.token.school_id, id, "pdf", { isStudent: true });
      if (r.status === "forbidden") { ResponseBuilder.forbidden(ErrorCode.MissingPermission, r.message, cb); return; }
      if (r.status === "not_found") { ResponseBuilder.notFound(ErrorCode.InvalidId, r.message, cb); return; }
      ResponseBuilder.ok({ fileName: r.fileName, mimeType: r.mimeType, base64Data: r.base64 }, cb);
    } catch (err: any) {
      ResponseBuilder.handleError(err, cb);
    }
  };
}

const handler = new SyllabusModelPaperHandler();
export const list = handler.list;
export const upload = handler.upload;
export const setAnswerKey = handler.setAnswerKey;
export const deleteDoc = handler.deleteDoc;
export const downloadStaff = handler.downloadStaff;
export const myPapers = handler.myPapers;
export const downloadStudent = handler.downloadStudent;
