import { preprocessWithFixture } from './fixture.js';
import { preprocessWithLibreOffice } from './pptx-pdf.js';
import { preprocessPptxTextOnly } from './pptx-text.js';
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

/**
 * auto: LibreOffice 渲染优先 → PPTX 纯文本降级 → fixture
 */
export async function preprocessDesignFile(opts: PreprocessOptions): Promise<PageBundle[]> {
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

  // auto
  try {
    return await preprocessWithLibreOffice(opts);
  } catch (loErr) {
    console.warn('[costing-preprocess] libreoffice unavailable:', loErr);
    if (isPptx(opts)) {
      try {
        return await preprocessPptxTextOnly(opts);
      } catch (pptxErr) {
        console.warn('[costing-preprocess] pptx-text failed, fallback fixture:', pptxErr);
        return preprocessWithFixture(opts);
      }
    }
    return preprocessWithFixture(opts);
  }
}
