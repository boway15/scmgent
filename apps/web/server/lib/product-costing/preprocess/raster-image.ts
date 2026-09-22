import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeProjectFile, resolveStoragePath } from '../storage.js';
import type { PageBundle, PreprocessOptions } from './types.js';

const RASTER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export function isRasterImageFile(fileName: string): boolean {
  const ext = path.extname(fileName.trim().toLowerCase());
  return RASTER_EXT.has(ext);
}

export async function preprocessRasterImage(opts: PreprocessOptions): Promise<PageBundle[]> {
  const sourceAbs = resolveStoragePath(opts.sourceStoragePath);
  const ext = path.extname(opts.fileName).toLowerCase();
  const imageRel = 'pages/page-1.png';
  const destAbs = resolveStoragePath(`${opts.projectId}/${imageRel}`);

  if (ext === '.png') {
    await copyFile(sourceAbs, destAbs);
  } else {
    const bytes = await readFile(sourceAbs);
    await writeProjectFile(opts.projectId, imageRel, bytes);
  }

  const text = opts.fileName.replace(/\.[^.]+$/, '').trim();
  return [
    {
      pageNo: 1,
      text,
      imagePath: destAbs,
      imageStoragePath: `${opts.projectId}/${imageRel}`,
    },
  ];
}
