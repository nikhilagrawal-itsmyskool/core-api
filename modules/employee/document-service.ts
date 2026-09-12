import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService } from "../../shared/lib/file-storage";
import {
  ENTITY_DOC_PDF, ENTITY_ACK_SIGNATURE, ENTITY_ACK_SIGNED_PAGE, // file_storage entity keys

  SIGNATURE_MAX_BYTES, SIGNATURE_ALLOWED_MIME,
  SIGNED_PAGE_MAX_BYTES, SIGNED_PAGE_ALLOWED_MIME,
  DOC_PDF_MAX_BYTES, DOC_PDF_ALLOWED_MIME,
} from "./document-constants";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

interface FileInput { fileName: string; mimeType: string; base64Data: string; }

function stripPrefix(b64: string): string {
  return (b64 || "").replace(/^data:[^;]+;base64,/, "");
}
// Normalize an exempt-roles value (array or CSV) to a lowercased CSV for storage, or null.
function rolesToCsv(v: any): string | null {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const clean = arr.map((r: any) => String(r).trim().toLowerCase()).filter(Boolean);
  return clean.length ? Array.from(new Set(clean)).join(",") : null;
}
function csvToRoles(v: any): string[] {
  return v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : [];
}
function sizeOf(b64: string): number {
  return Buffer.byteLength(stripPrefix(b64), "base64");
}

// Staff document handbook: versioned policy documents + per-employee acknowledgements
// (read & sign). Signing is per-document configurable — digital (typed declaration + a
// drawn signature) and/or upload (print, physically sign, upload the page).
class DocumentService {
  private async uploadFile(f: FileInput, entityType: string, entityId: string, schoolId: string, userId: string,
                           maxBytes: number, allowed: readonly string[]): Promise<string> {
    if (!f?.base64Data) throw new BusinessErrorResult(ErrorCode.BusinessError, "File data is required");
    if (!allowed.includes(f.mimeType)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Unsupported file type ${f.mimeType}. Allowed: ${allowed.join(", ")}`);
    }
    if (sizeOf(f.base64Data) > maxBytes) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    const stored = await fileStorageService.upload({
      fileName: f.fileName || "file", mimeType: f.mimeType, base64Data: stripPrefix(f.base64Data),
      entityType, entityId, schoolId, userId,
    });
    return stored.uuid;
  }

  private async activeEmployeeCount(schoolId: string): Promise<number> {
    const r = await DB.query(`select count(1)::int as n from employee where school_id = $1 and status = 'active'`, [schoolId]);
    return r[0]?.n || 0;
  }

  private mapDoc(d: any) {
    return {
      uuid: d.uuid, employeeId: d.employeeId || null, shared: !d.employeeId,
      code: d.code, title: d.title, category: d.category, version: d.version,
      summary: d.summary, bodyHtml: d.bodyHtml, hasPdf: !!d.pdfFileId, effectiveFrom: d.effectiveFrom,
      audience: d.audience, signModes: d.signModes, requiresAck: d.requiresAck, status: d.status,
      exemptRoles: csvToRoles(d.exemptRoles),
      createdAt: d.createdAt, updatedAt: d.updatedAt,
    };
  }

  // Employee ids that hold any of the given role names (lowercased). Defensive — a missing
  // role table never breaks the document flow. Used to exempt roles from signing.
  private async employeeIdsWithAnyRole(schoolId: string, roleNames: string[]): Promise<Set<string>> {
    const names = (roleNames || []).map((r) => String(r).toLowerCase()).filter(Boolean);
    if (!names.length) return new Set();
    try {
      const rows = await DB.query(
        singleLineString`select distinct er.employee_id from employee_role er
          join role r on r.uuid = er.role_id
          where er.school_id = $1 and lower(r.name) = any($2)`,
        [schoolId, names],
      );
      return new Set(rows.map((r: any) => r.employeeId).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  // ── Manager: documents CRUD ────────────────────────────────────────────────
  async listDocuments(schoolId: string, includeArchived = false): Promise<any[]> {
    const rows = await DB.query(
      singleLineString`select d.*, d.uuid as uuid,
          (select count(1)::int from employee_document_ack a
             where a.school_id = d.school_id and a.document_id = d.uuid and a.document_version = d.version and a.status = 'active') as signed_count
        from employee_document d
        where d.school_id = $1 ${includeArchived ? "" : "and d.status <> 'archived'"}
        order by d.status, d.updated_at desc nulls last, d.title`,
      [schoolId],
    );
    const required = await this.activeEmployeeCount(schoolId);
    return rows.map((d: any) => ({
      ...this.mapDoc(d),
      signedCount: d.signedCount || 0,
      requiredCount: d.requiresAck ? required : 0,
    }));
  }

  async getDocument(schoolId: string, id: string): Promise<any | null> {
    const rows = await DB.query(`select * from employee_document where school_id = $1 and uuid = $2`, [schoolId, id]);
    return rows.length ? this.mapDoc(rows[0]) : null;
  }

  private async loadRow(schoolId: string, id: string): Promise<any> {
    const rows = await DB.query(`select * from employee_document where school_id = $1 and uuid = $2`, [schoolId, id]);
    if (!rows.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "Document not found");
    return rows[0];
  }

  async createDocument(schoolId: string, data: any, userId: string): Promise<any> {
    if (!data.title || !data.code) throw new BusinessErrorResult(ErrorCode.BusinessError, "title and code are required");
    const signModes = data.signModes || "both";
    const audience = data.audience || "all";
    const status = data.status === "draft" ? "draft" : "published";
    const requiresAck = data.requiresAck !== false;
    const id = generateShortUuid(12);
    const now = new Date();
    let pdfFileId: string | null = null;
    if (data.pdf) pdfFileId = await this.uploadFile(data.pdf, ENTITY_DOC_PDF, id, schoolId, userId, DOC_PDF_MAX_BYTES, DOC_PDF_ALLOWED_MIME);
    await DB.query(
      singleLineString`insert into employee_document
        (uuid, school_id, code, title, category, version, summary, body_html, pdf_file_id, effective_from,
         audience, sign_modes, requires_ack, status, createdby_userid, created_at, updatedby_userid, updated_at, employee_id, exempt_roles)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$15,$16,$17,$18)`,
      [id, schoolId, data.code, data.title, data.category || "policy", 1, data.summary || null, data.bodyHtml || null,
        pdfFileId, data.effectiveFrom || null, audience, signModes, requiresAck, status, userId, now, data.employeeId || null, rolesToCsv(data.exemptRoles)],
    );
    return this.getDocument(schoolId, id);
  }

  // Two save modes:
  //   bumpVersion=false → cosmetic in-place edit; existing signatures stay valid.
  //   bumpVersion=true  → publish a NEW version row (v+1) and archive the old one. The old
  //     row is retained verbatim so we can always reproduce the exact text each person
  //     signed; every staff member's status flips to Pending against the new version.
  async updateDocument(schoolId: string, id: string, data: any, userId: string): Promise<any> {
    const row = await this.loadRow(schoolId, id);
    const now = new Date();
    const merged = {
      title: data.title ?? row.title,
      category: data.category ?? row.category,
      summary: data.summary ?? row.summary,
      bodyHtml: data.bodyHtml ?? row.bodyHtml,
      effectiveFrom: data.effectiveFrom ?? row.effectiveFrom,
      audience: data.audience ?? row.audience,
      signModes: data.signModes ?? row.signModes,
      requiresAck: data.requiresAck ?? row.requiresAck,
      status: data.status ?? row.status,
      exemptRolesCsv: "exemptRoles" in data ? rolesToCsv(data.exemptRoles) : (row.exemptRoles || null),
    };

    if (data.bumpVersion) {
      const newId = generateShortUuid(12);
      let pdfFileId = row.pdfFileId;
      if (data.pdf) pdfFileId = await this.uploadFile(data.pdf, ENTITY_DOC_PDF, newId, schoolId, userId, DOC_PDF_MAX_BYTES, DOC_PDF_ALLOWED_MIME);
      else if (data.removePdf) pdfFileId = null;
      await DB.query(
        singleLineString`insert into employee_document
          (uuid, school_id, code, title, category, version, summary, body_html, pdf_file_id, effective_from,
           audience, sign_modes, requires_ack, status, createdby_userid, created_at, updatedby_userid, updated_at, employee_id, exempt_roles)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'published',$14,$15,$14,$15,$16,$17)`,
        [newId, schoolId, row.code, merged.title, merged.category, row.version + 1, merged.summary, merged.bodyHtml,
          pdfFileId, merged.effectiveFrom, merged.audience, merged.signModes, merged.requiresAck, userId, now, row.employeeId || null, merged.exemptRolesCsv],
      );
      await DB.query(`update employee_document set status = 'archived', updatedby_userid = $1, updated_at = $2 where school_id = $3 and uuid = $4`,
        [userId, now, schoolId, id]);
      return this.getDocument(schoolId, newId);
    }

    // Cosmetic in-place edit — same version, same uuid, signatures unaffected.
    let pdfFileId = row.pdfFileId;
    if (data.pdf) pdfFileId = await this.uploadFile(data.pdf, ENTITY_DOC_PDF, id, schoolId, userId, DOC_PDF_MAX_BYTES, DOC_PDF_ALLOWED_MIME);
    else if (data.removePdf) pdfFileId = null;
    await DB.query(
      singleLineString`update employee_document set
          title = $1, category = $2, summary = $3, body_html = $4, pdf_file_id = $5, effective_from = $6,
          audience = $7, sign_modes = $8, requires_ack = $9, status = $10, exempt_roles = $11,
          updatedby_userid = $12, updated_at = $13
        where school_id = $14 and uuid = $15`,
      [merged.title, merged.category, merged.summary, merged.bodyHtml, pdfFileId, merged.effectiveFrom,
        merged.audience, merged.signModes, merged.requiresAck, merged.status, merged.exemptRolesCsv, userId, now, schoolId, id],
    );
    return this.getDocument(schoolId, id);
  }

  async archiveDocument(schoolId: string, id: string, userId: string): Promise<void> {
    await this.loadRow(schoolId, id);
    await DB.query(`update employee_document set status = 'archived', updatedby_userid = $1, updated_at = $2 where school_id = $3 and uuid = $4`,
      [userId, new Date(), schoolId, id]);
  }

  // Who has signed vs pending, for the current version of a document.
  async listAcks(schoolId: string, docId: string): Promise<any> {
    const doc = await this.loadRow(schoolId, docId);
    const rows = await DB.query(
      singleLineString`select e.uuid as employee_id, e.name as employee_name,
          a.uuid as ack_id, a.method, a.declared_name, a.declared_designation, a.agreed,
          a.signature_file_id, a.signed_page_file_id, a.acknowledged_at
        from employee e
        left join employee_document_ack a
          on a.school_id = e.school_id and a.employee_id = e.uuid
          and a.document_id = $2 and a.document_version = $3 and a.status = 'active'
        where e.school_id = $1 and e.status = 'active'
        order by (a.uuid is null), e.name`,
      [schoolId, docId, doc.version],
    );
    // Staff whose role is exempt still see the document but aren't part of the campaign —
    // drop them from the pending/required set (they still appear if they chose to sign).
    const exemptIds = await this.employeeIdsWithAnyRole(schoolId, csvToRoles(doc.exemptRoles));
    const signed = rows.filter((r: any) => r.ackId).map((r: any) => ({
      employeeId: r.employeeId, employeeName: r.employeeName, ackId: r.ackId, method: r.method,
      declaredName: r.declaredName, declaredDesignation: r.declaredDesignation, agreed: r.agreed,
      hasSignature: !!r.signatureFileId, hasSignedPage: !!r.signedPageFileId, acknowledgedAt: r.acknowledgedAt,
    }));
    const pending = rows
      .filter((r: any) => !r.ackId && !exemptIds.has(r.employeeId))
      .map((r: any) => ({ employeeId: r.employeeId, employeeName: r.employeeName }));
    return { document: this.mapDoc(doc), version: doc.version, signed, pending, signedCount: signed.length, pendingCount: pending.length };
  }

  // Fetch a stored artifact (drawn signature or uploaded signed page) as a data URI.
  async getAckArtifact(schoolId: string, ackId: string, which: "signature" | "page"): Promise<any | null> {
    const rows = await DB.query(`select signature_file_id, signed_page_file_id from employee_document_ack where school_id = $1 and uuid = $2`, [schoolId, ackId]);
    if (!rows.length) return null;
    const fileId = which === "signature" ? rows[0].signatureFileId : rows[0].signedPageFileId;
    if (!fileId) return null;
    const f = await fileStorageService.getWithData(fileId, schoolId);
    if (!f) return null;
    return { mimeType: f.mimeType, fileName: f.fileName, dataUri: `data:${f.mimeType};base64,${f.data}` };
  }

  // Who should be nudged about a document. Shared doc (null owner) → all active staff;
  // personal doc → its owner. `onlyPending` drops anyone who has already signed the
  // current version.
  async notifyRecipients(schoolId: string, docId: string, onlyPending: boolean): Promise<string[]> {
    const doc = await this.loadRow(schoolId, docId);
    if (!doc.requiresAck) return [];
    let ids: string[];
    if (doc.employeeId) {
      ids = [doc.employeeId];
    } else {
      const rows = await DB.query(`select uuid from employee where school_id = $1 and status = 'active'`, [schoolId]);
      ids = rows.map((r: any) => r.uuid);
    }
    // Don't nudge staff whose role is exempt from this document's campaign.
    const exemptIds = await this.employeeIdsWithAnyRole(schoolId, csvToRoles(doc.exemptRoles));
    if (exemptIds.size) ids = ids.filter((id) => !exemptIds.has(id));
    if (!onlyPending) return ids;
    const signed = await DB.query(
      `select employee_id from employee_document_ack where school_id = $1 and document_id = $2 and document_version = $3 and status = 'active'`,
      [schoolId, docId, doc.version],
    );
    const signedSet = new Set(signed.map((r: any) => r.employeeId));
    return ids.filter((id) => !signedSet.has(id));
  }

  async getDocPdf(schoolId: string, id: string): Promise<any | null> {
    const row = await this.loadRow(schoolId, id);
    if (!row.pdfFileId) return null;
    const f = await fileStorageService.getWithData(row.pdfFileId, schoolId);
    if (!f) return null;
    return { mimeType: f.mimeType, fileName: f.fileName, dataUri: `data:${f.mimeType};base64,${f.data}` };
  }

  // ── Employee /me surface ────────────────────────────────────────────────────
  private async myAck(schoolId: string, employeeId: string, docId: string, version: number): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select uuid, method, declared_name, declared_designation, declared_emp_id, agreed,
          signature_file_id, signed_page_file_id, acknowledged_at
        from employee_document_ack
        where school_id = $1 and employee_id = $2 and document_id = $3 and document_version = $4 and status = 'active'`,
      [schoolId, employeeId, docId, version],
    );
    if (!rows.length) return null;
    const a = rows[0];
    return {
      ackId: a.uuid, method: a.method, declaredName: a.declaredName, declaredDesignation: a.declaredDesignation,
      declaredEmpId: a.declaredEmpId, agreed: a.agreed, hasSignature: !!a.signatureFileId,
      hasSignedPage: !!a.signedPageFileId, acknowledgedAt: a.acknowledgedAt,
    };
  }

  // A document's signature applies to me unless my role is in its exempt list.
  private exemptForCaller(doc: any, callerRoles: string[]): boolean {
    const exempt = csvToRoles(doc.exemptRoles).map((r) => r.toLowerCase());
    if (!exempt.length) return false;
    const mine = (callerRoles || []).map((r) => String(r).toLowerCase());
    return mine.some((r) => exempt.includes(r));
  }

  async myDocuments(schoolId: string, employeeId: string, callerRoles: string[] = []): Promise<any[]> {
    const docs = await DB.query(
      singleLineString`select * from employee_document where school_id = $1 and status = 'published'
        and (employee_id is null or employee_id = $2)
        order by requires_ack desc, updated_at desc nulls last, title`,
      [schoolId, employeeId],
    );
    const out: any[] = [];
    for (const d of docs) {
      const exemptForMe = this.exemptForCaller(d, callerRoles);
      const signatureRequiredForMe = !!d.requiresAck && !exemptForMe;
      const ack = signatureRequiredForMe ? await this.myAck(schoolId, employeeId, d.uuid, d.version) : null;
      out.push({ ...this.mapDoc(d), bodyHtml: undefined, signed: !!ack, ack, exemptForMe, signatureRequiredForMe });
    }
    return out;
  }

  async getMyDocument(schoolId: string, employeeId: string, id: string, callerRoles: string[] = []): Promise<any> {
    const rows = await DB.query(
      singleLineString`select * from employee_document where school_id = $1 and uuid = $2 and status = 'published'
        and (employee_id is null or employee_id = $3)`,
      [schoolId, id, employeeId],
    );
    if (!rows.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "Document not found");
    const d = rows[0];
    const exemptForMe = this.exemptForCaller(d, callerRoles);
    const signatureRequiredForMe = !!d.requiresAck && !exemptForMe;
    const ack = signatureRequiredForMe ? await this.myAck(schoolId, employeeId, d.uuid, d.version) : null;
    const emp = await DB.query(`select name from employee where school_id = $1 and uuid = $2`, [schoolId, employeeId]);
    return { ...this.mapDoc(d), signed: !!ack, ack, exemptForMe, signatureRequiredForMe, prefill: { name: emp[0]?.name || "" } };
  }

  private assertMode(doc: any, method: "digital" | "upload") {
    const allowed = doc.signModes === "both" || doc.signModes === method;
    if (!allowed) throw new BusinessErrorResult(ErrorCode.BusinessError, `This document does not allow ${method === "digital" ? "digital signing" : "uploading a signed page"}`);
    if (!doc.requiresAck) throw new BusinessErrorResult(ErrorCode.BusinessError, "This document does not require a signature");
  }

  // Upsert one active ack for the current version (re-signing replaces the prior record).
  private async writeAck(schoolId: string, employeeId: string, doc: any, fields: any): Promise<any> {
    const now = new Date();
    const existing = await DB.query(
      `select uuid from employee_document_ack where school_id = $1 and employee_id = $2 and document_id = $3 and document_version = $4 and status = 'active'`,
      [schoolId, employeeId, doc.uuid, doc.version],
    );
    if (existing.length) {
      await DB.query(
        singleLineString`update employee_document_ack set method = $1, declared_name = $2, declared_designation = $3,
            declared_emp_id = $4, agreed = $5, signature_file_id = coalesce($6, signature_file_id),
            signed_page_file_id = coalesce($7, signed_page_file_id), ip = $8, user_agent = $9,
            acknowledged_at = $10, updated_at = $10
          where uuid = $11`,
        [fields.method, fields.declaredName, fields.declaredDesignation, fields.declaredEmpId, fields.agreed,
          fields.signatureFileId || null, fields.signedPageFileId || null, fields.ip, fields.userAgent, now, existing[0].uuid],
      );
      return this.myAck(schoolId, employeeId, doc.uuid, doc.version);
    }
    await DB.query(
      singleLineString`insert into employee_document_ack
        (uuid, school_id, document_id, document_version, employee_id, method, declared_name, declared_designation,
         declared_emp_id, agreed, signature_file_id, signed_page_file_id, ip, user_agent, status, acknowledged_at, created_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15,$15,$15)`,
      [generateShortUuid(12), schoolId, doc.uuid, doc.version, employeeId, fields.method, fields.declaredName,
        fields.declaredDesignation, fields.declaredEmpId, fields.agreed, fields.signatureFileId || null,
        fields.signedPageFileId || null, fields.ip, fields.userAgent, now],
    );
    return this.myAck(schoolId, employeeId, doc.uuid, doc.version);
  }

  async acknowledgeDigital(schoolId: string, employeeId: string, id: string, body: any, meta: any, userId: string): Promise<any> {
    const doc = await this.loadRow(schoolId, id);
    if (doc.status !== "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Document is not published");
    this.assertMode(doc, "digital");
    if (!body.agreed) throw new BusinessErrorResult(ErrorCode.BusinessError, "You must confirm you have read and agree");
    if (!body.declaredName || !String(body.declaredName).trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, "Your name is required on the declaration");
    if (!body.signatureBase64) throw new BusinessErrorResult(ErrorCode.BusinessError, "A signature is required");
    // entityId must fit file_storage.entity_id (varchar 12) — use the doc id; the precise
    // per-employee link is the ack row's signature_file_id.
    const sigId = await this.uploadFile(
      { fileName: `signature-${id}.png`, mimeType: body.signatureMimeType || "image/png", base64Data: body.signatureBase64 },
      ENTITY_ACK_SIGNATURE, id, schoolId, userId, SIGNATURE_MAX_BYTES, SIGNATURE_ALLOWED_MIME,
    );
    return this.writeAck(schoolId, employeeId, doc, {
      method: "digital", declaredName: String(body.declaredName).trim(),
      declaredDesignation: body.declaredDesignation ? String(body.declaredDesignation).trim() : null,
      declaredEmpId: body.declaredEmpId ? String(body.declaredEmpId).trim() : null,
      agreed: true, signatureFileId: sigId, ip: meta.ip, userAgent: meta.userAgent,
    });
  }

  async acknowledgeUpload(schoolId: string, employeeId: string, id: string, body: any, meta: any, userId: string): Promise<any> {
    const doc = await this.loadRow(schoolId, id);
    if (doc.status !== "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Document is not published");
    this.assertMode(doc, "upload");
    if (!body.base64Data) throw new BusinessErrorResult(ErrorCode.BusinessError, "The signed page file is required");
    // entityId must fit file_storage.entity_id (varchar 12) — use the doc id; the precise
    // per-employee link is the ack row's signed_page_file_id.
    const pageId = await this.uploadFile(
      { fileName: body.fileName || `signed-${id}.pdf`, mimeType: body.mimeType || "application/pdf", base64Data: body.base64Data },
      ENTITY_ACK_SIGNED_PAGE, id, schoolId, userId, SIGNED_PAGE_MAX_BYTES, SIGNED_PAGE_ALLOWED_MIME,
    );
    return this.writeAck(schoolId, employeeId, doc, {
      method: "upload", declaredName: body.declaredName ? String(body.declaredName).trim() : null,
      declaredDesignation: body.declaredDesignation ? String(body.declaredDesignation).trim() : null,
      declaredEmpId: body.declaredEmpId ? String(body.declaredEmpId).trim() : null,
      agreed: body.agreed !== false, signedPageFileId: pageId, ip: meta.ip, userAgent: meta.userAgent,
    });
  }

  async myDocPdf(schoolId: string, employeeId: string, id: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select uuid from employee_document where school_id = $1 and uuid = $2 and status = 'published'
        and (employee_id is null or employee_id = $3)`,
      [schoolId, id, employeeId],
    );
    if (!rows.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "Document not found");
    return this.getDocPdf(schoolId, id);
  }

  async myAckArtifact(schoolId: string, employeeId: string, id: string, which: "signature" | "page"): Promise<any | null> {
    const doc = await this.loadRow(schoolId, id);
    const ack = await this.myAck(schoolId, employeeId, id, doc.version);
    if (!ack) return null;
    return this.getAckArtifact(schoolId, ack.ackId, which);
  }
}

export const documentService = new DocumentService();
