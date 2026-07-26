import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService } from "../../shared/lib/file-storage";
import { DOC_TYPE_VALUES, EXAM_VALUES } from "./syllabus-constants";
import { ModelPaper, ModelPaperDoc, UploadPaperDocRequest } from "./syllabus-interfaces";
import { academicYearExists, findStudentClass, streamExists } from "./syllabus-common";
import { parseGrade } from "./syllabus-util";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

export type DownloadResult =
  | { status: "ok"; fileName: string; mimeType: string; base64: string }
  | { status: "forbidden"; message: string }
  | { status: "not_found"; message: string };

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const stripDataUri = (b64: string) => (b64 || "").replace(/^data:[^;]+;base64,/, "");

class SyllabusModelPaperService {
  // ── Admin/teacher: list paper sets with per-document state ─────────────────
  public async listPapers(
    schoolId: string,
    filters: { academicYearId?: string; grade?: string; streamCode?: string; subjectId?: string; exam?: string },
  ): Promise<ModelPaper[]> {
    const params: any[] = [schoolId];
    let q = singleLineString`
      select mp.uuid, mp.academic_year_id, mp.grade, mp.stream_code, mp.subject_id,
             mp.exam, mp.answer_key_released, sub.name as subject_name
      from syllabus_model_paper mp
      left join syllabus_subject sub on sub.uuid = mp.subject_id
      where mp.school_id = $1 and mp.status = 'active'
    `;
    let i = 2;
    if (filters.academicYearId) { q += ` and mp.academic_year_id = $${i++}`; params.push(filters.academicYearId); }
    if (filters.grade) { q += ` and lower(mp.grade) = lower($${i++})`; params.push(filters.grade.trim()); }
    if (filters.streamCode) {
      const sc = filters.streamCode.trim().toLowerCase();
      if (sc === "common" || sc === "null") q += ` and mp.stream_code is null`;
      else { q += ` and lower(mp.stream_code) = $${i++}`; params.push(sc); }
    }
    if (filters.subjectId) { q += ` and mp.subject_id = $${i++}`; params.push(filters.subjectId); }
    if (filters.exam) { q += ` and lower(mp.exam) = lower($${i++})`; params.push(filters.exam.trim()); }
    q += ` order by mp.grade, mp.exam, subject_name`;
    const papers = await DB.query(q, params);
    if (papers.length === 0) return [];

    const ids = papers.map((p: any) => p.uuid);
    const placeholders = ids.map((_: string, idx: number) => `$${idx + 2}`).join(", ");
    const docRows = await DB.query(
      singleLineString`
        select model_paper_id, uuid, doc_type, docx_file_id, pdf_file_id, pdf_status
        from syllabus_model_paper_doc
        where school_id = $1 and status = 'active' and model_paper_id in (${placeholders})
      `,
      [schoolId, ...ids],
    );
    const docsByPaper = new Map<string, ModelPaperDoc[]>();
    for (const d of docRows) {
      if (!docsByPaper.has(d.modelPaperId)) docsByPaper.set(d.modelPaperId, []);
      docsByPaper.get(d.modelPaperId)!.push({
        uuid: d.uuid,
        docType: d.docType,
        pdfStatus: d.pdfStatus,
        hasDocx: !!d.docxFileId,
        hasPdf: !!d.pdfFileId,
        docxFileId: d.docxFileId || null,
        pdfFileId: d.pdfFileId || null,
      });
    }
    return papers.map((p: any) => ({
      uuid: p.uuid,
      academicYearId: p.academicYearId,
      grade: p.grade,
      streamCode: p.streamCode || null,
      subjectId: p.subjectId,
      subjectName: p.subjectName || null,
      exam: p.exam,
      answerKeyReleased: p.answerKeyReleased,
      docs: docsByPaper.get(p.uuid) || [],
    }));
  }

  // Find-or-create the paper header for (year, grade, stream, subject, exam).
  private async ensurePaper(
    schoolId: string,
    userId: string,
    d: { academicYearId: string; grade: string; streamCode: string | null; subjectId: string; exam: string },
  ): Promise<{ uuid: string; answerKeyReleased: boolean }> {
    const existing = await DB.query(
      singleLineString`
        select uuid, answer_key_released from syllabus_model_paper
        where school_id = $1 and academic_year_id = $2 and lower(grade) = lower($3)
          and coalesce(lower(stream_code), '') = $4 and subject_id = $5 and lower(exam) = lower($6)
          and status = 'active'
        limit 1
      `,
      [schoolId, d.academicYearId, d.grade.trim(), (d.streamCode || "").toLowerCase(), d.subjectId, d.exam.trim()],
    );
    if (existing.length > 0) return { uuid: existing[0].uuid, answerKeyReleased: existing[0].answerKeyReleased };

    const uuid = generateShortUuid(12);
    await DB.query(
      singleLineString`
        insert into syllabus_model_paper
        (uuid, school_id, academic_year_id, grade, stream_code, subject_id, exam, answer_key_released, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10)
      `,
      [uuid, schoolId, d.academicYearId, d.grade.trim(), d.streamCode || null, d.subjectId, d.exam.trim(), false, userId, new Date()],
    );
    return { uuid, answerKeyReleased: false };
  }

  // ── Admin/teacher: upload a document (Word, optionally a ready PDF) ─────────
  public async uploadDoc(
    schoolId: string,
    userId: string,
    data: UploadPaperDocRequest,
  ): Promise<ModelPaper> {
    if (!EXAM_VALUES.includes(data.exam as any)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `exam must be one of: ${EXAM_VALUES.join(", ")}`);
    }
    if (!DOC_TYPE_VALUES.includes(data.docType as any)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `docType must be one of: ${DOC_TYPE_VALUES.join(", ")}`);
    }
    if (!data.grade || !data.grade.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, "grade is required");
    if (!data.subjectId) throw new BusinessErrorResult(ErrorCode.BusinessError, "subjectId is required");
    if (!data.base64Data) throw new BusinessErrorResult(ErrorCode.BusinessError, "file data is required");
    if (!(await academicYearExists(schoolId, data.academicYearId))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid academicYearId");
    }
    const streamCode = data.streamCode?.trim() || null;
    if (streamCode && !(await streamExists(schoolId, streamCode))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Unknown stream "${streamCode}"`);
    }
    const subject = await DB.query(
      singleLineString`select 1 from syllabus_subject where uuid = $1 and school_id = $2 and status = 'active'`,
      [data.subjectId, schoolId],
    );
    if (subject.length === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid subjectId");

    const paper = await this.ensurePaper(schoolId, userId, {
      academicYearId: data.academicYearId,
      grade: data.grade,
      streamCode,
      subjectId: data.subjectId,
      exam: data.exam,
    });

    const existing = await DB.query(
      singleLineString`
        select uuid, docx_file_id, pdf_file_id from syllabus_model_paper_doc
        where model_paper_id = $1 and doc_type = $2 and status = 'active' limit 1
      `,
      [paper.uuid, data.docType],
    );

    // Store the Word source.
    const docx = await fileStorageService.upload({
      fileName: data.fileName,
      mimeType: data.mimeType || DOCX_MIME,
      base64Data: stripDataUri(data.base64Data),
      entityType: "syllabus_model_paper_doc",
      entityId: paper.uuid,
      schoolId,
      userId,
    });

    // Optionally attach a ready-made PDF (skips conversion); otherwise queue it.
    let pdfFileId: string | null = null;
    let pdfStatus = "pending";
    if (data.pdfBase64Data) {
      const pdf = await fileStorageService.upload({
        fileName: data.pdfFileName || data.fileName.replace(/\.docx?$/i, ".pdf"),
        mimeType: PDF_MIME,
        base64Data: stripDataUri(data.pdfBase64Data),
        entityType: "syllabus_model_paper_doc",
        entityId: paper.uuid,
        schoolId,
        userId,
      });
      pdfFileId = pdf.uuid;
      pdfStatus = "ready";
    }

    const now = new Date();
    if (existing.length > 0) {
      await DB.query(
        singleLineString`
          update syllabus_model_paper_doc
          set docx_file_id = $1, pdf_file_id = $2, pdf_status = $3, pdf_attempts = 0, pdf_error = null,
              updatedby_userid = $4, updated_at = $5
          where uuid = $6
        `,
        [docx.uuid, pdfFileId, pdfStatus, userId, now, existing[0].uuid],
      );
      // Remove the superseded files.
      if (existing[0].docxFileId) await fileStorageService.delete(existing[0].docxFileId, schoolId);
      if (existing[0].pdfFileId) await fileStorageService.delete(existing[0].pdfFileId, schoolId);
    } else {
      await DB.query(
        singleLineString`
          insert into syllabus_model_paper_doc
          (uuid, school_id, model_paper_id, doc_type, docx_file_id, pdf_file_id, pdf_status, pdf_attempts, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, 0, 'active', $8, $9)
        `,
        [generateShortUuid(12), schoolId, paper.uuid, data.docType, docx.uuid, pdfFileId, pdfStatus, userId, now],
      );
    }

    const refreshed = await this.listPapers(schoolId, {
      academicYearId: data.academicYearId, grade: data.grade,
      streamCode: streamCode || "common", subjectId: data.subjectId, exam: data.exam,
    });
    return refreshed[0];
  }

  public async setAnswerKeyReleased(
    schoolId: string, userId: string, paperId: string, released: boolean,
  ): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`
        update syllabus_model_paper set answer_key_released = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5 and status = 'active'
        returning uuid
      `,
      [released, userId, new Date(), paperId, schoolId],
    );
    return rows.length > 0;
  }

  // ── Download a document, enforcing visibility ──────────────────────────────
  // format: 'pdf' | 'docx'. Students: never docx; answer-key pdf only when released.
  // Returns a discriminated result so the handler can set 200/403/404.
  public async getDocForDownload(
    schoolId: string,
    docId: string,
    format: "pdf" | "docx",
    opts: { isStudent: boolean },
  ): Promise<DownloadResult> {
    const rows = await DB.query(
      singleLineString`
        select d.doc_type, d.docx_file_id, d.pdf_file_id, d.pdf_status, mp.answer_key_released
        from syllabus_model_paper_doc d
        join syllabus_model_paper mp on mp.uuid = d.model_paper_id and mp.status = 'active'
        where d.uuid = $1 and d.school_id = $2 and d.status = 'active'
        limit 1
      `,
      [docId, schoolId],
    );
    if (rows.length === 0) return { status: "not_found", message: "Document not found" };
    const doc = rows[0];

    if (format === "docx") {
      if (opts.isStudent) return { status: "forbidden", message: "Word files are staff-only" };
      if (!doc.docxFileId) return { status: "not_found", message: "Word file not available" };
      return this.serveFile(doc.docxFileId, schoolId);
    }

    // pdf
    if (doc.docType === "answer_key" && opts.isStudent && !doc.answerKeyReleased) {
      return { status: "forbidden", message: "The answer key has not been released yet" };
    }
    if (!doc.pdfFileId) {
      return {
        status: "not_found",
        message: doc.pdfStatus === "pending" ? "PDF is still being generated" : "PDF not available",
      };
    }
    return this.serveFile(doc.pdfFileId, schoolId);
  }

  private async serveFile(fileId: string, schoolId: string): Promise<DownloadResult> {
    const file = await fileStorageService.getWithData(fileId, schoolId);
    if (!file) return { status: "not_found", message: "File not found" };
    return { status: "ok", fileName: file.fileName, mimeType: file.mimeType, base64: file.data };
  }

  public async deleteDoc(schoolId: string, userId: string, docId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select docx_file_id, pdf_file_id from syllabus_model_paper_doc where uuid = $1 and school_id = $2 and status = 'active'`,
      [docId, schoolId],
    );
    if (rows.length === 0) return false;
    await DB.query(
      singleLineString`update syllabus_model_paper_doc set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      [userId, new Date(), docId, schoolId],
    );
    if (rows[0].docxFileId) await fileStorageService.delete(rows[0].docxFileId, schoolId);
    if (rows[0].pdfFileId) await fileStorageService.delete(rows[0].pdfFileId, schoolId);
    return true;
  }

  // ── Student app: the papers a child can see for the year ───────────────────
  // Their grade + stream (common + own stream), only documents with a ready PDF,
  // and the answer key only when released.
  public async studentPapers(
    schoolId: string,
    studentId: string,
    academicYearId: string,
    filters: { subjectId?: string; exam?: string },
  ): Promise<any[]> {
    const placement = await findStudentClass(schoolId, studentId, academicYearId);
    if (!placement) return [];
    const grade = parseGrade(placement.className);
    const streamCode = placement.streamCode;

    const params: any[] = [schoolId, academicYearId, grade, streamCode];
    let q = singleLineString`
      select mp.uuid, mp.subject_id, mp.stream_code, mp.exam, mp.answer_key_released, sub.name as subject_name
      from syllabus_model_paper mp
      left join syllabus_subject sub on sub.uuid = mp.subject_id
      where mp.school_id = $1 and mp.academic_year_id = $2 and lower(mp.grade) = lower($3) and mp.status = 'active'
        and (mp.stream_code is null or lower(mp.stream_code) = lower($4))
    `;
    let i = 5;
    if (filters.subjectId) { q += ` and mp.subject_id = $${i++}`; params.push(filters.subjectId); }
    if (filters.exam) { q += ` and lower(mp.exam) = lower($${i++})`; params.push(filters.exam.trim()); }
    q += ` order by sub.name, mp.exam`;
    const papers = await DB.query(q, params);
    if (papers.length === 0) return [];

    const ids = papers.map((p: any) => p.uuid);
    const placeholders = ids.map((_: string, idx: number) => `$${idx + 2}`).join(", ");
    const docRows = await DB.query(
      singleLineString`
        select model_paper_id, uuid, doc_type, pdf_file_id, pdf_status
        from syllabus_model_paper_doc
        where school_id = $1 and status = 'active' and pdf_status = 'ready' and model_paper_id in (${placeholders})
      `,
      [schoolId, ...ids],
    );
    const docsByPaper = new Map<string, any[]>();
    for (const d of docRows) {
      if (!d.pdfFileId) continue;
      if (!docsByPaper.has(d.modelPaperId)) docsByPaper.set(d.modelPaperId, []);
      docsByPaper.get(d.modelPaperId)!.push(d);
    }

    return papers
      .map((p: any) => {
        const visible = (docsByPaper.get(p.uuid) || []).filter(
          (d: any) => d.docType !== "answer_key" || p.answerKeyReleased,
        );
        return {
          uuid: p.uuid,
          subjectId: p.subjectId,
          subjectName: p.subjectName || null,
          streamCode: p.streamCode || null,
          exam: p.exam,
          answerKeyReleased: p.answerKeyReleased,
          docs: visible.map((d: any) => ({ uuid: d.uuid, docType: d.docType })),
        };
      })
      .filter((p: any) => p.docs.length > 0);
  }
}

export const syllabusModelPaperService = new SyllabusModelPaperService();
