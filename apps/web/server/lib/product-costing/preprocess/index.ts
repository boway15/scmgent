import { access } from 'node:fs/promises';
import { preprocessWithFixture } from './fixture.js';
import { preprocessWithLibreOffice } from './pptx-pdf.js';
import { preprocessPptxTextOnly } from './pptx-text.js';
import { resolveStoragePath } from '../storage.js';
import type { PageBundle, PreprocessOptions } from './types.js';

export type { PageBundle, PreprocessOptions } from './types.js';

export function getPreprocessMode(): 'fixture' | 'libreoffice' | 'auto' {
  const mode = process.env.COSTING_PREPROCESS_MODE?.trim().toLowerCase();
  if (mode === 'fixture' || mode === 'libreoffice' || mode === 'auto') return mode;
  return 'auto';
}

function isPptx(opts: PreprocessOptions): boolean {
  return (
    opts.fileName.toLowerCase().endsWith('.pptx') ||
    opts.contentType.includes('presentationml')
  );
}

async function assertSourceExists(opts: PreprocessOptions): Promise<void> {
  const abs = resolveStoragePath(opts.sourceStoragePath);
  try {
    await access(abs);
  } catch {
    throw new Error(
      `方案原件不存在（${opts.sourceStoragePath}）。请重新上传 PPT/PDF 后再执行 AI 拆解（重建容器会导致未挂载卷的文件丢失）。`,
    );
  }
}

/**
 * auto: LibreOffice 渲染优先 → PPTX 纯文本降级。
 * fixture 仅当显式 COSTING_PREPROCESS_MODE=fixture。
 */
export async function preprocessDesignFile(opts: PreprocessOptions): Promise<PageBundle[]> {
  await assertSourceExists(opts);

  const mode = getPreprocessMode();
  if (mode === 'fixture') return preprocessWithFixture(opts);

  if (mode === 'libreoffice') {
    try {
      return await preprocessWithLibreOffice(opts);
    } catch (err) {
      if (isPptx(opts)) {
        console.warn('[costing-preprocess] libreoffice failed, fallback pptx-text:', err);
        return preprocessPptxTextOnly(opts);
      }
      throw err;
    }
  }

  // auto — do NOT silently fall back to fixture (会产生假文本导致 Dify 返回空清单)
  try {
    return await preprocessWithLibreOffice(opts);
  } catch (loErr) {
    console.warn('[costing-preprocess] libreoffice unavailable:', loErr);
    if (isPptx(opts)) {
      return preprocessPptxTextOnly(opts);
    }
    throw new Error(
      `无法预处理该文件（无 LibreOffice/poppler，且非 PPTX）。原始错误：${
        loErr instanceof Error ? loErr.message : String(loErr)
      }`,
    );
  }
}
