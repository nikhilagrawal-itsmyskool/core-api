import { DB, singleLineString } from './db';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
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

// ── Cloudflare R2 (S3-compatible), opt-in PER ENTITY TYPE ────────────────────────────
// R2 charges $0 for egress. We route only the entity types listed in R2_ENTITY_TYPES (e.g.
// 'outreach' — parent-facing Moments photos, downloaded by many families) to R2; everything
// else stays on S3. Each file row records its backend in storage_provider, so reads presign /
// fetch against the right store. Inert unless all four R2_* env vars are set.
const R2_ENDPOINT = process.env.R2_ENDPOINT as string; // https://<account>.r2.cloudflarestorage.com
const R2_BUCKET = process.env.R2_BUCKET as string;
const R2_ENTITY_TYPES = new Set(
  (process.env.R2_ENTITY_TYPES || '').split(',').map((s) => s.trim()).filter(Boolean),
);
const r2Configured = !!(R2_ENDPOINT && R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

let _r2: S3Client | null = null;
function r2Client(): S3Client {
  if (!_r2) {
    _r2 = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    });
  }
  return _r2;
}

// Should this entity type's bytes live in R2 (and is R2 configured)?
function useR2(entityType: string): boolean {
  return r2Configured && R2_ENTITY_TYPES.has(entityType);
}

// Short-lived presigned GET URL for a stored object, so clients (e.g. the command
// palette) can render an <img> straight from S3 without base64. Returns null when
// S3 isn't configured (local/Postgres mode) or there's no key.
export async function getSignedPhotoUrl(
  storageKey: string | null | undefined,
  expiresIn = 300,
  provider?: string | null,
): Promise<string | null> {
  if (!storageKey) return null;
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  // R2-backed object → presign against R2 (zero egress). Else S3 as before.
  if (provider === 'r2') {
    if (!r2Configured) return null;
    return getSignedUrl(r2Client(), new GetObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }), { expiresIn });
  }
  if (!FILE_STORAGE_BUCKET) return null;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: FILE_STORAGE_BUCKET, Key: storageKey }), { expiresIn });
}

// Whether R2 is usable (all four R2_* env vars present). Exported so callers that upload
// LARGE objects directly to R2 (presigned PUT, bypassing the base64 API path) can check first.
export const r2Available = r2Configured;

// Presigned PUT so a browser can upload a large file (e.g. a video) straight to R2 — the API
// can't carry it as base64 (Gateway's ~10 MB request cap). The client PUTs the bytes with the
// SAME Content-Type that is signed here. R2-only; null when R2 isn't configured.
export async function getR2UploadUrl(
  storageKey: string,
  contentType: string,
  expiresIn = 900,
): Promise<string | null> {
  if (!r2Configured) return null;
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(
    r2Client(),
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: storageKey, ContentType: contentType }),
    { expiresIn },
  );
}

// Confirm an object exists in R2 (used to verify a direct upload finished before recording it).
export async function r2ObjectExists(storageKey: string): Promise<boolean> {
  if (!r2Configured || !storageKey) return false;
  try {
    await r2Client().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }));
    return true;
  } catch {
    return false;
  }
}

// Best-effort delete of an R2 object by key (for removing an uploaded video's bytes).
export async function r2DeleteObject(storageKey: string): Promise<void> {
  if (!r2Configured || !storageKey) return;
  try {
    await r2Client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }));
  } catch (err) {
    console.error(`file-storage: failed to delete R2 object ${storageKey}`, err);
  }
}

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
    const toR2 = useR2(input.entityType);

    await (toR2 ? r2Client() : s3).send(new PutObjectCommand({
      Bucket: toR2 ? R2_BUCKET : FILE_STORAGE_BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: input.mimeType,
    }));

    const query = singleLineString`
      insert into file_storage
      (uuid, file_name, mime_type, size_bytes, data, storage_key, storage_provider, entity_type, entity_id, variant, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;
    const params = [
      uuid, input.fileName, input.mimeType, sizeBytes,
      null, storageKey, toR2 ? 'r2' : 's3',
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
      select uuid, file_name, mime_type, size_bytes, data, storage_key, storage_provider, entity_type, entity_id, variant, school_id, createdby_userid, created_at
      from file_storage
      where uuid = $1 and school_id = $2
    `;
    const results = await DB.query(query, [uuid, schoolId]);
    if (results.length === 0) return null;
    const row = results[0];

    let data: string;
    if (row.storageKey) {
      // Fetch from the bucket that holds it — R2 when storage_provider='r2', else S3.
      const fromR2 = row.storageProvider === 'r2';
      const obj = await (fromR2 ? r2Client() : s3).send(
        new GetObjectCommand({ Bucket: fromR2 ? R2_BUCKET : FILE_STORAGE_BUCKET, Key: row.storageKey }),
      );
      data = await (obj.Body as any).transformToString('base64');
    } else {
      // Legacy row not yet migrated: fall back to the DB blob (dual-read).
      data = row.data;
    }
    return { ...row, data };
  }

  public async delete(uuid: string, schoolId: string): Promise<void> {
    const meta = await DB.query(
      singleLineString`select storage_key, storage_provider from file_storage where uuid = $1 and school_id = $2`,
      [uuid, schoolId],
    );
    if (meta.length > 0 && meta[0].storageKey) {
      // Best-effort: a storage-delete failure (e.g. a missing IAM action, or an
      // already-gone object) must not block the logical delete. Log and carry on;
      // an orphaned object is harmless and can be swept later. Delete from the bucket
      // that actually holds it (R2 vs S3).
      const fromR2 = meta[0].storageProvider === 'r2';
      try {
        await (fromR2 ? r2Client() : s3).send(
          new DeleteObjectCommand({ Bucket: fromR2 ? R2_BUCKET : FILE_STORAGE_BUCKET, Key: meta[0].storageKey }),
        );
      } catch (err) {
        console.error(`file-storage: failed to delete ${fromR2 ? 'R2' : 'S3'} object ${meta[0].storageKey}; removing the DB row anyway`, err);
      }
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
