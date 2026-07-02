import { DB, singleLineString } from '../../shared/lib/db';
import { fileStorageService } from '../../shared/lib/file-storage';
import { HiringFileMeta, HiringFileWithData, UploadFileRequest } from './hiring-interfaces';
import { FileKind } from './hiring-constants';

const COLUMN_FOR_KIND: Record<FileKind, string> = {
  photo: 'photo_file_id',
  resume: 'resume_file_id',
};

class HiringFileService {
  // Upload a photo or resume for a candidate. Replaces any existing file of the
  // same kind (old file removed from file_storage) and points the candidate
  // column at the new file.
  public async upload(
    candidateId: string,
    data: UploadFileRequest,
    schoolId: string,
    userId: string
  ): Promise<HiringFileMeta> {
    const column = COLUMN_FOR_KIND[data.kind];

    // Remove the previous file of this kind, if any.
    const existing = await DB.query(
      singleLineString`select ${column} as file_id from hiring_candidate where uuid = $1 and school_id = $2`,
      [candidateId, schoolId]
    );
    const previousFileId = existing.length > 0 ? existing[0].fileId : null;

    const stored = await fileStorageService.upload({
      fileName: data.fileName,
      mimeType: data.mimeType,
      base64Data: data.base64Data,
      entityType: `hiring_candidate_${data.kind}`,
      entityId: candidateId,
      schoolId,
      userId,
    });

    const now = new Date();
    await DB.query(
      singleLineString`
        update hiring_candidate
        set ${column} = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `,
      [stored.uuid, userId, now, candidateId, schoolId]
    );

    if (previousFileId) {
      await fileStorageService.delete(previousFileId, schoolId);
    }

    return {
      uuid: stored.uuid,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    };
  }

  public async getWithData(fileId: string, schoolId: string): Promise<HiringFileWithData | null> {
    const file = await fileStorageService.getWithData(fileId, schoolId);
    if (!file) return null;
    return {
      uuid: file.uuid,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      data: file.data,
    };
  }

  public async delete(
    candidateId: string,
    kind: FileKind,
    schoolId: string,
    userId: string
  ): Promise<boolean> {
    const column = COLUMN_FOR_KIND[kind];
    const existing = await DB.query(
      singleLineString`select ${column} as file_id from hiring_candidate where uuid = $1 and school_id = $2`,
      [candidateId, schoolId]
    );
    if (existing.length === 0) return false;
    const fileId = existing[0].fileId;
    if (!fileId) return false;

    await fileStorageService.delete(fileId, schoolId);

    const now = new Date();
    await DB.query(
      singleLineString`
        update hiring_candidate
        set ${column} = null, updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4
      `,
      [userId, now, candidateId, schoolId]
    );
    return true;
  }
}

export const hiringFileService = new HiringFileService();
