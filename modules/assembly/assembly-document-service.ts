import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { fileStorageService } from '../../shared/lib/file-storage';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Reference documents the assembly was built from (the source Word/PDF), kept for
// reference + download + edit. One active doc per (school, kind). Bytes live in the
// shared file_storage; this table holds the metadata + one-per-slot semantics.
const KINDS = ['plan', 'checklist', 'grading'] as const;
type Kind = (typeof KINDS)[number];
const ENTITY_TYPE = 'assembly_document';
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

const stripDataUri = (b64: string) => (b64 || '').replace(/^data:[^;]+;base64,/, '');

export interface AssemblyDocView {
  uuid: string;
  kind: Kind;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  uploadedByName: string | null;
}

export interface UploadDocRequest {
  kind: Kind;
  fileName: string;
  mimeType?: string;
  base64Data: string;
}

class AssemblyDocumentService {
  // The current reference docs for a school (0–3), one per kind.
  async list(schoolId: string): Promise<AssemblyDocView[]> {
    const rows = await DB.query(
      singleLineString`
        select d.uuid, d.kind, d.file_name, d.mime_type, d.size_bytes,
               d.uploaded_at::text as uploaded_at, e.name as uploaded_by_name
        from assembly_document d
        left join employee e on e.uuid = d.uploadedby_userid and e.school_id = d.school_id
        where d.school_id = $1 and d.status = 'active'
        order by d.kind
      `,
      [schoolId],
    );
    return rows.map((r: any) => ({
      uuid: r.uuid,
      kind: r.kind,
      fileName: r.fileName || null,
      mimeType: r.mimeType || null,
      sizeBytes: r.sizeBytes ?? null,
      uploadedAt: r.uploadedAt || null,
      uploadedByName: r.uploadedByName || null,
    }));
  }

  // Upload (or replace) the reference doc for a kind. Returns the refreshed list.
  async upload(schoolId: string, userId: string, req: UploadDocRequest): Promise<AssemblyDocView[]> {
    if (!KINDS.includes(req.kind)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `kind must be one of: ${KINDS.join(', ')}`);
    }
    if (!req.base64Data) throw new BusinessErrorResult(ErrorCode.BusinessError, 'file data is required');
    const clean = stripDataUri(req.base64Data);
    const sizeBytes = Buffer.byteLength(clean, 'base64');
    if (sizeBytes > MAX_BYTES) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `File too large (max ${Math.round(MAX_BYTES / (1024 * 1024))} MB)`);
    }

    const docId = generateShortUuid(12);
    const now = new Date();
    const stored = await fileStorageService.upload({
      fileName: req.fileName || `assembly-${req.kind}`,
      mimeType: req.mimeType || 'application/octet-stream',
      base64Data: clean,
      entityType: ENTITY_TYPE,
      entityId: docId,
      schoolId,
      userId,
    });

    // Supersede any existing active doc of this kind (and drop its bytes).
    const prior = await DB.query(
      singleLineString`select uuid, file_id from assembly_document where school_id = $1 and kind = $2 and status = 'active'`,
      [schoolId, req.kind],
    );
    await DB.query(
      singleLineString`
        insert into assembly_document
          (uuid, school_id, kind, file_id, file_name, mime_type, size_bytes, status, uploadedby_userid, uploaded_at)
        values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
      `,
      [docId, schoolId, req.kind, stored.uuid, req.fileName || null, req.mimeType || null, sizeBytes, userId, now],
    );
    for (const p of prior) {
      await DB.query(
        singleLineString`update assembly_document set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3`,
        [userId, now, p.uuid],
      );
      if (p.fileId) await fileStorageService.delete(p.fileId, schoolId);
    }
    return this.list(schoolId);
  }

  // The document bytes (base64) for download.
  async getFile(schoolId: string, id: string): Promise<{ fileName: string; mimeType: string; base64: string } | null> {
    const rows = await DB.query(
      singleLineString`select file_id, file_name, mime_type from assembly_document where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    if (rows.length === 0) return null;
    const file = await fileStorageService.getWithData(rows[0].fileId, schoolId);
    if (!file) return null;
    return {
      fileName: rows[0].fileName || file.fileName,
      mimeType: rows[0].mimeType || file.mimeType,
      base64: file.data,
    };
  }

  // Remove a reference doc (soft-delete + drop the bytes). Returns the refreshed list.
  async remove(schoolId: string, userId: string, id: string): Promise<AssemblyDocView[] | null> {
    const rows = await DB.query(
      singleLineString`select file_id from assembly_document where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    if (rows.length === 0) return null;
    await DB.query(
      singleLineString`update assembly_document set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      [userId, new Date(), id, schoolId],
    );
    if (rows[0].fileId) await fileStorageService.delete(rows[0].fileId, schoolId);
    return this.list(schoolId);
  }
}

export const assemblyDocumentService = new AssemblyDocumentService();
