import { IFileSystem } from './i-filesystem';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

export class LocalFileSystem implements IFileSystem {
  private async waitForUnlock(lockPath: string, timeout = 2000, interval = 100): Promise<void> {
    const start = Date.now();
    while (existsSync(lockPath)) {
      if (Date.now() - start > timeout) {
        throw new Error(`Timeout waiting for lock on ${lockPath}`);
      }
      await new Promise(res => setTimeout(res, interval));
    }
  }

  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw err;
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const lockPath = `${filePath}.lock`;
    const dirPath = path.dirname(filePath);

    // 🔧 Ensure parent directory exists
    await fs.mkdir(dirPath, { recursive: true });

    try {
      await fs.open(lockPath, 'wx'); // Try to create lock file
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        await this.waitForUnlock(lockPath);
        return this.writeFile(filePath, content); // Retry after waiting
      }
      throw err;
    }

    try {
      await fs.writeFile(filePath, content, 'utf-8');
    } finally {
      await fs.unlink(lockPath).catch(() => {});
    }
  }
}
