import { DB, singleLineString } from '../../shared/lib/db';
import { fileStorageService, StoredFile, StoredFileWithData } from '../../shared/lib/file-storage';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { UploadPhotoRequest } from './employee-interfaces';
import { PHOTO_ALLOWED_MIME, PHOTO_ENTITY_TYPE, PHOTO_MAX_BYTES } from './employee-constants';

// Employee photos in the shared file_storage (entity_type='employee'), mirroring student photos:
// one row per (entity, variant), original + thumb.
class EmployeePhotoService {
  private async assertEmployeeExists(entityId: string, schoolId: string): Promise<void> {
    const rows = await DB.query(
      singleLineString`select 1 from employee where uuid = $1 and school_id = $2 and status <> 'deleted' limit 1`,
      [entityId, schoolId]
    );
    if (rows.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'employee not found');
    }
  }

  public async upload(entityId: string, data: UploadPhotoRequest, schoolId: string, userId: string): Promise<StoredFile> {
    if (!data.base64Data || !data.mimeType) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'mimeType and base64Data are required');
    }
    if (!(PHOTO_ALLOWED_MIME as readonly string[]).includes(data.mimeType)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Unsupported image type. Allowed: ${PHOTO_ALLOWED_MIME.join(', ')}`);
    }
    if (Buffer.byteLength(data.base64Data, 'base64') > PHOTO_MAX_BYTES) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Image too large (max ${Math.round(PHOTO_MAX_BYTES / (1024 * 1024))} MB)`);
    }
    const variant = data.variant === 'thumb' ? 'thumb' : 'original';
    await this.assertEmployeeExists(entityId, schoolId);
    await this.deleteVariant(entityId, schoolId, variant); // one photo per variant
    return fileStorageService.upload({
      fileName: data.fileName || `employee-${entityId}-${variant}.img`,
      mimeType: data.mimeType,
      base64Data: data.base64Data,
      entityType: PHOTO_ENTITY_TYPE,
      entityId,
      variant,
      schoolId,
      userId,
    });
  }

  public async getLatestWithData(entityId: string, schoolId: string, variant = 'original'): Promise<StoredFileWithData | null> {
    const rows = await DB.query(
      singleLineString`select uuid from file_storage
        where entity_type = $1 and entity_id = $2 and school_id = $3
          and (variant = $4 or (variant is null and $4 = 'original'))
        order by created_at desc limit 1`,
      [PHOTO_ENTITY_TYPE, entityId, schoolId, variant]
    );
    if (rows.length === 0) return null;
    return fileStorageService.getWithData(rows[0].uuid, schoolId);
  }

  public async deleteVariant(entityId: string, schoolId: string, variant: string): Promise<number> {
    const rows = await DB.query(
      singleLineString`select uuid from file_storage
        where entity_type = $1 and entity_id = $2 and school_id = $3
          and (variant = $4 or (variant is null and $4 = 'original'))`,
      [PHOTO_ENTITY_TYPE, entityId, schoolId, variant]
    );
    for (const r of rows) await fileStorageService.delete(r.uuid, schoolId);
    return rows.length;
  }

  public async deleteAll(entityId: string, schoolId: string): Promise<number> {
    const rows = await DB.query(
      singleLineString`select uuid from file_storage where entity_type = $1 and entity_id = $2 and school_id = $3`,
      [PHOTO_ENTITY_TYPE, entityId, schoolId]
    );
    for (const r of rows) await fileStorageService.delete(r.uuid, schoolId);
    return rows.length;
  }
}

export const employeePhotoService = new EmployeePhotoService();
