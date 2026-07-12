import { DB, singleLineString } from './db';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { extname } from 'path';
const { generateShortUuid } = require('../util/generate-uuid.js');

export interface FileUploadInput {
  fileName: string;
  mimeType: string;
  base64Data: string; // raw base64, no data: URI prefix
  entityType: string;
  entityId: string;
  schoolId: string;
  userId: string;
  variant?: string; // 'original' (default) | 'thumb'
}

export interface StoredFile {
  uuid: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  entityType: string;
  entityId: string;
  variant?: string;
  schoolId: string;
  createdbyUserid: string;
  createdAt: Date;
}

export interface StoredFileWithData extends StoredFile {
  data: string; // base64
}

export interface IFileStorageService {
  upload(input: FileUploadInput): Promise<StoredFile>;
  getMetadata(uuid: string, schoolId: string): Promise<StoredFile | null>;
  getWithData(uuid: string, schoolId: string): Promise<StoredFileWithData | null>;
  delete(uuid: string, schoolId: string): Promise<void>;
}

class PostgresFileStorageService implements IFileStorageService {
  public async upload(input: FileUploadInput): Promise<StoredFile> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const sizeBytes = Buffer.byteLength(input.base64Data, 'base64');

    const query = singleLineString`
      insert into file_storage
      (uuid, file_name, mime_type, size_bytes, data, entity_type, entity_id, variant, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

    const params = [
      uuid,
      input.fileName,
      input.mimeType,
      sizeBytes,
      input.base64Data,
      input.entityType,
      input.entityId,
      input.variant || 'original',
      input.schoolId,
      input.userId,
      now,
    ];

    await DB.query(query, params);
    return this.getMetadata(uuid, input.schoolId) as Promise<StoredFile>;
  }

  public async getMetadata(uuid: string, schoolId: string): Promise<StoredFile | null> {
    const query = singleLineString`
      select uuid, file_name, mime_type, size_bytes, entity_type, entity_id, variant, school_id, createdby_userid, created_at
      from file_storage
      where uuid = $1 and school_id = $2
    `;
    const results = await DB.query(query, [uuid, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async getWithData(uuid: string, schoolId: string): Promise<StoredFileWithData | null> {
    const query = singleLineString`
      select uuid, file_name, mime_type, size_bytes, data, entity_type, entity_id, variant, school_id, createdby_userid, created_at
      from file_storage
      where uuid = $1 and school_id = $2
    `;
    const results = await DB.query(query, [uuid, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async delete(uuid: string, schoolId: string): Promise<void> {
    const query = singleLineString`
      delete from file_storage where uuid = $1 and school_id = $2
    `;
    await DB.query(query, [uuid, schoolId]);
  }
}

// ---- S3-backed implementation ----

const s3 = new S3Client({});
const FILE_STORAGE_BUCKET = process.env.FILE_STORAGE_BUCKET as string;

// S3 key scheme: {schoolId}/{entityType}/{entityId}/{variant}/{uuid}{ext}
// IMPORTANT: keep this in sync with scripts/migrate-file-storage-to-s3.js
export function buildStorageKey(f: {
  schoolId: string; entityType: string; entityId: string; uuid: string; fileName: string; variant?: string;
}): string {
  const ext = extname(f.fileName || '');
  return `${f.schoolId}/${f.entityType}/${f.entityId}/${f.variant || 'original'}/${f.uuid}${ext}`;
}

class S3FileStorageService implements IFileStorageService {
  public async upload(input: FileUploadInput): Promise<StoredFile> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const buffer = Buffer.from(input.base64Data, 'base64');
    const sizeBytes = buffer.length;
    const storageKey = buildStorageKey({ ...input, uuid });

    await s3.send(new PutObjectCommand({
      Bucket: FILE_STORAGE_BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: input.mimeType,
    }));

    const query = singleLineString`
      insert into file_storage
      (uuid, file_name, mime_type, size_bytes, data, storage_key, entity_type, entity_id, variant, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;
    const params = [
      uuid, input.fileName, input.mimeType, sizeBytes,
      null, storageKey,
      input.entityType, input.entityId, input.variant || 'original', input.schoolId, input.userId, now,
    ];
    await DB.query(query, params);
    return this.getMetadata(uuid, input.schoolId) as Promise<StoredFile>;
  }

  public async getMetadata(uuid: string, schoolId: string): Promise<StoredFile | null> {
    const query = singleLineString`
      select uuid, file_name, mime_type, size_bytes, entity_type, entity_id, variant, school_id, createdby_userid, created_at
      from file_storage
      where uuid = $1 and school_id = $2
    `;
    const results = await DB.query(query, [uuid, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async getWithData(uuid: string, schoolId: string): Promise<StoredFileWithData | null> {
    const query = singleLineString`
      select uuid, file_name, mime_type, size_bytes, data, storage_key, entity_type, entity_id, variant, school_id, createdby_userid, created_at
      from file_storage
      where uuid = $1 and school_id = $2
    `;
    const results = await DB.query(query, [uuid, schoolId]);
    if (results.length === 0) return null;
    const row = results[0];

    let data: string;
    if (row.storageKey) {
      const obj = await s3.send(new GetObjectCommand({ Bucket: FILE_STORAGE_BUCKET, Key: row.storageKey }));
      data = await (obj.Body as any).transformToString('base64');
    } else {
      // Legacy row not yet migrated: fall back to the DB blob (dual-read).
      data = row.data;
    }
    return { ...row, data };
  }

  public async delete(uuid: string, schoolId: string): Promise<void> {
    const meta = await DB.query(
      singleLineString`select storage_key from file_storage where uuid = $1 and school_id = $2`,
      [uuid, schoolId],
    );
    if (meta.length > 0 && meta[0].storageKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: FILE_STORAGE_BUCKET, Key: meta[0].storageKey }));
    }
    await DB.query(
      singleLineString`delete from file_storage where uuid = $1 and school_id = $2`,
      [uuid, schoolId],
    );
  }
}

// Use S3 only when the bucket is configured (FILE_STORAGE_BUCKET set in the stage
// config). Until then it stays on Postgres, so deploying this code changes nothing
// behaviorally. The S3 impl dual-reads (S3 when storage_key is set, else the DB blob),
// so it is safe to switch on before the migration finishes.
export const fileStorageService: IFileStorageService = process.env.FILE_STORAGE_BUCKET
  ? new S3FileStorageService()
  : new PostgresFileStorageService();
