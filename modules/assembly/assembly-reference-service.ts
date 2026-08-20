import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { fileStorageService, getSignedPhotoUrl } from '../../shared/lib/file-storage';
import {
  REFERENCE_ENTITY_TYPE, REFERENCE_MAX_PER_DAY, REFERENCE_IMAGE_MAX_BYTES,
  REFERENCE_ALLOWED_MIME, REFERENCE_DESCRIPTION_MAX,
} from './assembly-constants';
import { AddReferenceRequest, UpdateReferenceRequest, RosterReferenceView } from './assembly-interfaces';
import { assemblyWeekService } from './assembly-week-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const stripDataUri = (b64: string) => (b64 || '').replace(/^data:[^;]+;base64,/, '');

// Day-level assembly references (a description + one image, up to 5 per day). Editable
// while the roster week is a draft; visible to staff once the week is approved. Bytes
// live in the shared file_storage; this table holds metadata + the file_id.
class AssemblyReferenceService {
  // All active references for a week, ordered (date, sort_order), each with a presigned
  // image URL (null in local/DB mode — the caller falls back to getFile bytes).
  async listForWeek(schoolId: string, weekId: string): Promise<RosterReferenceView[]> {
    const rows = await DB.query(
      singleLineString`
        select uuid, entry_date::text as entry_date, sort_order, description,
               file_id, file_name, mime_type, size_bytes
        from assembly_roster_reference
        where week_id = $1 and school_id = $2 and status = 'active'
        order by entry_date, sort_order
      `,
      [weekId, schoolId],
    );
    if (!rows.length) return [];
    const files = await DB.query(
      singleLineString`select uuid as file_id, storage_key from file_storage where school_id = $1 and uuid = any($2)`,
      [schoolId, rows.map((r: any) => r.fileId)],
    );
    const keyMap = new Map<string, string | null>(files.map((f: any) => [f.fileId, f.storageKey || null]));
    const out: RosterReferenceView[] = [];
    for (const r of rows) {
      const storageKey = keyMap.get(r.fileId) || null;
      out.push({
        uuid: r.uuid,
        entryDate: r.entryDate,
        sortOrder: r.sortOrder,
        description: r.description,
        fileName: r.fileName || undefined,
        mimeType: r.mimeType || undefined,
        sizeBytes: r.sizeBytes ?? undefined,
        imageUrl: storageKey ? await getSignedPhotoUrl(storageKey) : null,
        fileId: r.fileId,
      });
    }
    return out;
  }

  async listForDate(schoolId: string, weekId: string, entryDate: string): Promise<RosterReferenceView[]> {
    return (await this.listForWeek(schoolId, weekId)).filter((r) => r.entryDate === entryDate);
  }

  // Add a reference to a day. Returns the refreshed references for that date, or null
  // when the week is missing (→ 404). Throws a business error when the week is locked,
  // the date is not an assembly day, validation fails, or the 5-per-day cap is reached.
  async add(schoolId: string, userId: string, weekId: string, req: AddReferenceRequest): Promise<RosterReferenceView[] | null> {
    const editable = await assemblyWeekService.assertEditableWeek(weekId, schoolId);
    if (!editable) return null;
    if (!req.entryDate || !editable.validDates.has(req.entryDate)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Date ${req.entryDate} is not an assembly day of this week`);
    }
    const description = (req.description || '').trim();
    if (!description) throw new BusinessErrorResult(ErrorCode.BusinessError, 'description is required');
    if (description.length > REFERENCE_DESCRIPTION_MAX) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `description is too long (max ${REFERENCE_DESCRIPTION_MAX} chars)`);
    }
    if (!req.base64Data) throw new BusinessErrorResult(ErrorCode.BusinessError, 'image (mimeType + base64Data) is required');
    if (!req.mimeType || !(REFERENCE_ALLOWED_MIME as readonly string[]).includes(req.mimeType)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Unsupported image type. Allowed: ${REFERENCE_ALLOWED_MIME.join(', ')}`);
    }
    const clean = stripDataUri(req.base64Data);
    const sizeBytes = Buffer.byteLength(clean, 'base64');
    if (sizeBytes > REFERENCE_IMAGE_MAX_BYTES) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Image too large (max ${Math.round(REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024))} MB)`);
    }

    const cnt = await DB.query(
      singleLineString`select count(1)::int as n from assembly_roster_reference where week_id = $1 and entry_date = $2 and status = 'active'`,
      [weekId, req.entryDate],
    );
    if (cnt[0].n >= REFERENCE_MAX_PER_DAY) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `At most ${REFERENCE_MAX_PER_DAY} references per day`);
    }

    const refId = generateShortUuid(12);
    const now = new Date();
    const seqRow = await DB.query(
      singleLineString`select coalesce(max(sort_order), 0) + 1 as next from assembly_roster_reference where week_id = $1 and entry_date = $2 and status = 'active'`,
      [weekId, req.entryDate],
    );
    const stored = await fileStorageService.upload({
      fileName: req.fileName || `assembly-reference-${refId}.img`,
      mimeType: req.mimeType,
      base64Data: clean,
      entityType: REFERENCE_ENTITY_TYPE,
      entityId: refId,
      variant: 'original',
      schoolId,
      userId,
    });
    await DB.query(
      singleLineString`
        insert into assembly_roster_reference
          (uuid, school_id, week_id, entry_date, sort_order, description, file_id, file_name, mime_type, size_bytes, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12)
      `,
      [refId, schoolId, weekId, req.entryDate, seqRow[0].next, description, stored.uuid, req.fileName || null, req.mimeType || null, sizeBytes, userId, now],
    );
    return this.listForDate(schoolId, weekId, req.entryDate);
  }

  // Edit a reference's description. Returns the refreshed references for its date, or
  // null when the week/reference is missing (→ 404).
  async update(schoolId: string, userId: string, weekId: string, refId: string, req: UpdateReferenceRequest): Promise<RosterReferenceView[] | null> {
    const editable = await assemblyWeekService.assertEditableWeek(weekId, schoolId);
    if (!editable) return null;
    const ref = await this.refRow(schoolId, weekId, refId);
    if (!ref) return null;
    const description = (req.description || '').trim();
    if (!description) throw new BusinessErrorResult(ErrorCode.BusinessError, 'description is required');
    if (description.length > REFERENCE_DESCRIPTION_MAX) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `description is too long (max ${REFERENCE_DESCRIPTION_MAX} chars)`);
    }
    await DB.query(
      singleLineString`update assembly_roster_reference set description = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and week_id = $5 and school_id = $6`,
      [description, userId, new Date(), refId, weekId, schoolId],
    );
    return this.listForDate(schoolId, weekId, ref.entryDate);
  }

  // Remove a reference (soft-delete + drop the image bytes). Returns the refreshed
  // references for its date, or null when the week/reference is missing (→ 404).
  async remove(schoolId: string, userId: string, weekId: string, refId: string): Promise<RosterReferenceView[] | null> {
    const editable = await assemblyWeekService.assertEditableWeek(weekId, schoolId);
    if (!editable) return null;
    const ref = await this.refRow(schoolId, weekId, refId);
    if (!ref) return null;
    if (ref.fileId) await fileStorageService.delete(ref.fileId, schoolId);
    await DB.query(
      singleLineString`update assembly_roster_reference set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and week_id = $4 and school_id = $5`,
      [userId, new Date(), refId, weekId, schoolId],
    );
    return this.listForDate(schoolId, weekId, ref.entryDate);
  }

  // The image bytes (base64) for a reference — local-dev fallback when there is no
  // presigned URL.
  async getFile(schoolId: string, refId: string): Promise<{ fileName: string; mimeType: string; base64: string } | null> {
    const rows = await DB.query(
      singleLineString`select file_id, file_name, mime_type from assembly_roster_reference where uuid = $1 and school_id = $2 and status = 'active'`,
      [refId, schoolId],
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

  private async refRow(schoolId: string, weekId: string, refId: string): Promise<{ entryDate: string; fileId: string } | null> {
    const rows = await DB.query(
      singleLineString`select entry_date::text as entry_date, file_id from assembly_roster_reference where uuid = $1 and week_id = $2 and school_id = $3 and status = 'active'`,
      [refId, weekId, schoolId],
    );
    return rows.length ? { entryDate: rows[0].entryDate, fileId: rows[0].fileId } : null;
  }
}

export const assemblyReferenceService = new AssemblyReferenceService();
