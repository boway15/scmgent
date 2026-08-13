import { readFile } from 'node:fs/promises';
import { writeProjectFile } from '../storage.js';
import type { PageBundle, PreprocessOptions } from './types.js';

/** 1x1 PNG */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Fixture mode: one synthetic page for CI / local without LibreOffice. */
export async function preprocessWithFixture(opts: PreprocessOptions): Promise<PageBundle[]> {
  let text = `fixture page for ${opts.fileName}`;
  try {
    const { resolveStoragePath } = await import('../storage.js');
    const abs = resolveStoragePath(opts.sourceStoragePath);
    const buf = await readFile(abs);
    // Best-effort text peek for pptx/xml or utf8 pdf
    const sample = buf.subarray(0, Math.min(buf.length, 64_000)).toString('utf8');
    const matches = sample.match(/[\u4e00-\u9fffA-Za-z0-9]{2,}/g);
    if (matches?.length) {
      text = matches.slice(0, 40).join(' ');
    }
  } catch {
    /* keep default text */
  }

  const imageRel = 'pages/page-1.png';
  const textRel = 'pages/page-1.txt';
  const imageWritten = await writeProjectFile(opts.projectId, imageRel, TINY_PNG);
  const textWritten = await writeProjectFile(opts.projectId, textRel, Buffer.from(text, 'utf8'));
  const { resolveStoragePath } = await import('../storage.js');

  return [
    {
      pageNo: 1,
      text,
      imagePath: resolveStoragePath(imageWritten.storagePath),
      imageStoragePath: imageWritten.storagePath,
      textStoragePath: textWritten.storagePath,
    },
  ];
}
