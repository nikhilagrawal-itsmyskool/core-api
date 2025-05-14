import { IFileSystem } from './i-filesystem';
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

export class S3FileSystem implements IFileSystem {
  constructor(private s3: S3Client, private bucket: string) {}

  private async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  private async waitForUnlock(lockKey: string, timeout = 2000, interval = 100): Promise<void> {
    const start = Date.now();
    while (await this.exists(lockKey)) {
      if (Date.now() - start > timeout) {
        throw new Error(`Timeout waiting for lock on ${lockKey}`);
      }
      await new Promise(res => setTimeout(res, interval));
    }
  }

  async readFile(key: string): Promise<string> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body || !(res.Body instanceof Readable)) throw new Error("Invalid body");
      return await streamToString(res.Body as Readable);
    } catch (err: any) {
      if (err.name === 'NoSuchKey') {
        throw new Error(`File not found: ${key}`);
      }
      throw err;
    }
  }

  async writeFile(key: string, content: string): Promise<void> {
    const lockKey = `${key}.lock`;

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: lockKey,
        Body: '',
        ContentType: 'text/plain',
        // Ensure atomicity via conditional put
        // AWS SDK v3 doesn't support If-None-Match easily, so we rely on timing
      }));
    } catch {
      await this.waitForUnlock(lockKey);
      return this.writeFile(key, content); // Retry
    }

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: 'text/plain',
      }));
    } finally {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: lockKey })).catch(() => {});
    }
  }
}
