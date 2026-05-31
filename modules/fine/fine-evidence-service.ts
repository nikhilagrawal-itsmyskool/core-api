import { DB, singleLineString } from '../../shared/lib/db';
import { fileStorageService } from '../../shared/lib/file-storage';
import {
  FineIncidentEvidenceMeta,
  FineIncidentEvidenceWithData,
  UploadEvidenceRequest,
} from './fine-interfaces';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class FineEvidenceService {
  public async upload(
    incidentId: string,
    data: UploadEvidenceRequest,
    schoolId: string,
    userId: string
  ): Promise<FineIncidentEvidenceMeta> {
    const uuid = generateShortUuid(12);
    const now = new Date();

    // Upload file to shared file_storage
    const stored = await fileStorageService.upload({
      fileName: data.fileName,
      mimeType: data.mimeType,
      base64Data: data.base64Data,
      entityType: 'fine_incident',
      entityId: incidentId,
      schoolId,
      userId,
    });

    // Create evidence record
    const query = singleLineString`
      insert into fine_incident_evidence
      (uuid, incident_id, school_id, file_id, uploaded_by_id, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, 'active', $6, $7)
    `;

    await DB.query(query, [uuid, incidentId, schoolId, stored.uuid, userId, userId, now]);

    return this.getMetadata(uuid, schoolId) as Promise<FineIncidentEvidenceMeta>;
  }

  public async getWithData(
    evidenceId: string,
    schoolId: string
  ): Promise<FineIncidentEvidenceWithData | null> {
    const meta = await this.getMetadata(evidenceId, schoolId);
    if (!meta) return null;

    const fileData = await fileStorageService.getWithData(meta.fileId, schoolId);
    if (!fileData) return null;

    return { ...meta, data: fileData.data };
  }

  public async getMetadata(
    evidenceId: string,
    schoolId: string
  ): Promise<FineIncidentEvidenceMeta | null> {
    const query = singleLineString`
      select e.*, fs.file_name, fs.mime_type, fs.size_bytes
      from fine_incident_evidence e
      join file_storage fs on e.file_id = fs.uuid
      where e.uuid = $1 and e.school_id = $2 and e.status = 'active'
    `;
    const results = await DB.query(query, [evidenceId, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async delete(
    evidenceId: string,
    schoolId: string,
    userId: string
  ): Promise<boolean> {
    const existing = await this.getMetadata(evidenceId, schoolId);
    if (!existing) return false;

    const now = new Date();

    // Delete file from file_storage
    await fileStorageService.delete(existing.fileId, schoolId);

    // Soft-delete evidence record
    const query = singleLineString`
      update fine_incident_evidence
      set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4
    `;
    await DB.query(query, [userId, now, evidenceId, schoolId]);

    return true;
  }
}

export const fineEvidenceService = new FineEvidenceService();
