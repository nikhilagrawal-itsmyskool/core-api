import { DB, singleLineString } from './db';
const { generateShortUuid } = require('../util/generate-uuid.js');

export interface FileUploadInput {
  fileName: string;
  mimeType: string;
  base64Data: string; // raw base64, no data: URI prefix
  entityType: string;
  entityId: string;
  schoolId: string;
  userId: string;
}

export interface StoredFile {
  uuid: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  entityType: string;
  entityId: string;
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
      (uuid, file_name, mime_type, size_bytes, data, entity_type, entity_id, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

    const params = [
      uuid,
      input.fileName,
      input.mimeType,
      sizeBytes,
      input.base64Data,
      input.entityType,
      input.entityId,
      input.schoolId,
      input.userId,
      now,
    ];

    await DB.query(query, params);
    return this.getMetadata(uuid, input.schoolId) as Promise<StoredFile>;
  }

  public async getMetadata(uuid: string, schoolId: string): Promise<StoredFile | null> {
    const query = singleLineString`
      select uuid, file_name, mime_type, size_bytes, entity_type, entity_id, school_id, createdby_userid, created_at
      from file_storage
      where uuid = $1 and school_id = $2
    `;
    const results = await DB.query(query, [uuid, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async getWithData(uuid: string, schoolId: string): Promise<StoredFileWithData | null> {
    const query = singleLineString`
      select uuid, file_name, mime_type, size_bytes, data, entity_type, entity_id, school_id, createdby_userid, created_at
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

export const fileStorageService: IFileStorageService = new PostgresFileStorageService();
