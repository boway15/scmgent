import { mkdir, rename, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';

export function getDownloadDataDir(): string {
  const fromEnv = process.env.DOWNLOAD_DATA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), 'data', 'downloads');
}

function assertJobId(jobId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    throw new Error('invalid jobId');
  }
  return jobId;
}

export function downloadJobDir(jobId: string): string {
  return path.join(getDownloadDataDir(), assertJobId(jobId));
}

export async function ensureDownloadJobDir(jobId: string): Promise<string> {
  const dir = downloadJobDir(jobId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Resolve a storage_path relative to DOWNLOAD_DATA_DIR; reject traversal. */
export function resolveDownloadStoragePath(storagePath: string): string {
  if (!storagePath || storagePath.includes('\0')) {
    throw new Error('invalid storage path');
  }
  const normalized = storagePath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.includes('..') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('path traversal rejected');
  }
  const root = path.resolve(getDownloadDataDir());
  const abs = path.resolve(root, normalized);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('path traversal rejected');
  }
  return abs;
}

export async function writeDownloadFile(
  jobId: string,
  fileName: string,
  content: Buffer | string,
): Promise<{ storagePath: string; fileSize: number }> {
  const safeName = path.basename(fileName).replace(/[^\w.\u4e00-\u9fff-]+/g, '_') || 'export.bin';
  const dir = await ensureDownloadJobDir(jobId);
  const tmpAbs = path.join(dir, `${safeName}.tmp`);
  const finalAbs = path.join(dir, safeName);
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  await writeFile(tmpAbs, buf);
  await rename(tmpAbs, finalAbs);
  const storagePath = path.posix.join(assertJobId(jobId), safeName);
  return { storagePath, fileSize: buf.byteLength };
}

export async function removeDownloadJobFiles(jobId: string): Promise<void> {
  const dir = downloadJobDir(jobId);
  await rm(dir, { recursive: true, force: true });
}

export async function openDownloadFileStream(storagePath: string) {
  const abs = resolveDownloadStoragePath(storagePath);
  const info = await stat(abs);
  return { stream: createReadStream(abs), size: info.size, abs };
}
