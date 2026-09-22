import { inflateRawSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { resolveStoragePath, writeProjectFile } from '../storage.js';
import type { PageBundle, PreprocessOptions } from './types.js';

/** 1x1 PNG placeholder when page render is unavailable */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

type ZipEntry = { name: string; compression: number; compressed: Buffer };

/** Read ZIP via end-of-central-directory (handles PPTX data descriptors). */
function readZipEntries(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('invalid zip: EOCD not found');

  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let offset = cdOffset;

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const compression = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    entries.push({ name, compression, compressed });

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function inflateEntry(entry: ZipEntry): string {
  if (entry.compression === 0) return entry.compressed.toString('utf8');
  if (entry.compression === 8) return inflateRawSync(entry.compressed).toString('utf8');
  throw new Error(`unsupported zip compression ${entry.compression}`);
}

export async function extractPptxSlideTexts(sourceAbs: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const buf = await readFile(sourceAbs);
  const entries = readZipEntries(buf);
  const slides = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.name))
    .sort(
      (a, b) =>
        Number(a.name.match(/(\d+)/)?.[1] ?? 0) - Number(b.name.match(/(\d+)/)?.[1] ?? 0),
    );
  for (const slide of slides) {
    const pageNo = Number(slide.name.match(/(\d+)/)?.[1] ?? 0);
    try {
      const xml = inflateEntry(slide);
      const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1]).filter(Boolean);
      map.set(pageNo, texts.join('\n'));
    } catch {
      map.set(pageNo, '');
    }
  }
  return map;
}

/**
 * PPTX text-only preprocess: real per-slide text + placeholder images.
 * Used when LibreOffice/poppler are unavailable (e.g. Alpine image).
 */
export async function preprocessPptxTextOnly(opts: PreprocessOptions): Promise<PageBundle[]> {
  const sourceAbs = resolveStoragePath(opts.sourceStoragePath);
  const textByPage = await extractPptxSlideTexts(sourceAbs);
  if (!textByPage.size) {
    throw new Error('未能从 PPTX 抽取幻灯片文本');
  }

  const pages: PageBundle[] = [];
  for (const [pageNo, text] of [...textByPage.entries()].sort((a, b) => a[0] - b[0])) {
    const imageRel = `pages/page-${pageNo}.png`;
    const textRel = `pages/page-${pageNo}.txt`;
    const note = text
      ? text
      : `（第 ${pageNo} 页无抽取到文字；当前环境无页图渲染，请在 notes 中人工补尺寸）`;
    const imageWritten = await writeProjectFile(opts.projectId, imageRel, TINY_PNG);
    const textWritten = await writeProjectFile(opts.projectId, textRel, Buffer.from(note, 'utf8'));
    pages.push({
      pageNo,
      text: note,
      imagePath: resolveStoragePath(imageWritten.storagePath),
      imageStoragePath: imageWritten.storagePath,
      textStoragePath: textWritten.storagePath,
    });
  }
  return pages;
}
