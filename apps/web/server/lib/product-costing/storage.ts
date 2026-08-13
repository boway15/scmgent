import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function getCostingDataDir(): string {
  const fromEnv = process.env.COSTING_DATA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), 'data', 'costing');
}

export function projectDir(projectId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
    throw new Error('invalid projectId');
  }
  return path.join(getCostingDataDir(), projectId);
}

export async function ensureProjectDir(projectId: string): Promise<string> {
  const dir = projectDir(projectId);
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(dir, 'pages'), { recursive: true });
  return dir;
}

export async function writeProjectFile(
  projectId: string,
  relativeName: string,
  buf: Buffer,
): Promise<{ storagePath: string; byteSize: number }> {
  if (relativeName.includes('..') || path.isAbsolute(relativeName)) {
    throw new Error('invalid relative path');
  }
  const dir = await ensureProjectDir(projectId);
  const abs = path.join(dir, relativeName);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  const storagePath = path.posix.join(projectId, relativeName.replace(/\\/g, '/'));
  return { storagePath, byteSize: buf.byteLength };
}

/** Resolve a storage_path relative to COSTING_DATA_DIR; reject traversal. */
export function resolveStoragePath(storagePath: string): string {
  if (!storagePath || storagePath.includes('\0')) {
    throw new Error('invalid storage path');
  }
  const normalized = storagePath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.includes('..') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('path traversal rejected');
  }
  const root = path.resolve(getCostingDataDir());
  const abs = path.resolve(root, normalized);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('path traversal rejected');
  }
  return abs;
}

export async function removeProjectDir(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  await rm(dir, { recursive: true, force: true });
}
