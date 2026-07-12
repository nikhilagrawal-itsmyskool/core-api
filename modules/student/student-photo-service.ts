import { DB, singleLineString } from '../../shared/lib/db';
import { fileStorageService, StoredFile, StoredFileWithData } from '../../shared/lib/file-storage';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { UploadPhotoRequest } from './student-interfaces';
import { PHOTO_ALLOWED_MIME, PHOTO_MAX_BYTES, PHOTO_ENTITY_TYPES, PhotoEntityType } from './student-constants';

class StudentPhotoService {
  private assertValidType(entityType: string): asserts entityType is PhotoEntityType {
    if (!(PHOTO_ENTITY_TYPES as readonly string[]).includes(entityType)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid photo entity type');
    }
  }

  // Confirm the target student/guardian exists in this school before attaching a photo.
  private async assertEntityExists(
    entityType: PhotoEntityType,
    entityId: string,
    schoolId: string
  ): Promise<void> {
    const table = entityType === 'student' ? 'student' : 'student_guardian';
    const statusFilter = entityType === 'student' ? "status <> 'deleted'" : "status = 'active'";
    const rows = await DB.query(
      `select 1 from ${table} where uuid = $1 and school_id = $2 and ${statusFilter} limit 1`,
      [entityId, schoolId]
    );
    if (rows.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `${entityType} not found`);
    }
  }

  public async upload(
    entityType: string,
    entityId: string,
    data: UploadPhotoRequest,
    schoolId: string,
    userId: string
  ): Promise<StoredFile> {
    this.assertValidType(entityType);

    if (!data.base64Data || !data.mimeType) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'mimeType and base64Data are required');
    }
    if (!(PHOTO_ALLOWED_MIME as readonly string[]).includes(data.mimeType)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Unsupported image type. Allowed: ${PHOTO_ALLOWED_MIME.join(', ')}`
      );
    }
    const sizeBytes = Buffer.byteLength(data.base64Data, 'base64');
    if (sizeBytes > PHOTO_MAX_BYTES) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Image too large (max ${Math.round(PHOTO_MAX_BYTES / (1024 * 1024))} MB)`
      );
    }
    const variant = data.variant === 'thumb' ? 'thumb' : 'original';

    await this.assertEntityExists(entityType, entityId, schoolId);

    // One photo per entity per variant: remove any prior photo of this variant.
    await this.deleteVariant(entityType, entityId, schoolId, variant);

    return fileStorageService.upload({
      fileName: data.fileName || `${entityType}-${entityId}-${variant}.img`,
      mimeType: data.mimeType,
      base64Data: data.base64Data,
      entityType,
      entityId,
      variant,
      schoolId,
      userId,
    });
  }

  public async getLatestWithData(
    entityType: string,
    entityId: string,
    schoolId: string,
    variant: string = 'original'
  ): Promise<StoredFileWithData | null> {
    this.assertValidType(entityType);
    const rows = await DB.query(
      singleLineString`
        select uuid from file_storage
        where entity_type = $1 and entity_id = $2 and school_id = $3
          and (variant = $4 or (variant is null and $4 = 'original'))
        order by created_at desc limit 1
      `,
      [entityType, entityId, schoolId, variant]
    );
    if (rows.length === 0) return null;
    return fileStorageService.getWithData(rows[0].uuid, schoolId);
  }

  // Delete a single variant (null variant counts as 'original').
  public async deleteVariant(
    entityType: string,
    entityId: string,
    schoolId: string,
    variant: string
  ): Promise<number> {
    this.assertValidType(entityType);
    const rows = await DB.query(
      singleLineString`
        select uuid from file_storage
        where entity_type = $1 and entity_id = $2 and school_id = $3
          and (variant = $4 or (variant is null and $4 = 'original'))
      `,
      [entityType, entityId, schoolId, variant]
    );
    for (const r of rows) {
      await fileStorageService.delete(r.uuid, schoolId);
    }
    return rows.length;
  }

  public async deleteAll(
    entityType: string,
    entityId: string,
    schoolId: string
  ): Promise<number> {
    this.assertValidType(entityType);
    const rows = await DB.query(
      singleLineString`
        select uuid from file_storage
        where entity_type = $1 and entity_id = $2 and school_id = $3
      `,
      [entityType, entityId, schoolId]
    );
    for (const r of rows) {
      await fileStorageService.delete(r.uuid, schoolId);
    }
    return rows.length;
  }
}

export const studentPhotoService = new StudentPhotoService();
