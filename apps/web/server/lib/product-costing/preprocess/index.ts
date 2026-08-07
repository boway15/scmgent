import { preprocessWithFixture } from './fixture.js';
import { preprocessWithLibreOffice } from './pptx-pdf.js';
import type { PageBundle, PreprocessOptions } from './types.js';

export type { PageBundle, PreprocessOptions } from './types.js';

export function getPreprocessMode(): 'fixture' | 'libreoffice' {
  const mode = process.env.COSTING_PREPROCESS_MODE?.trim().toLowerCase();
  if (mode === 'fixture') return 'fixture';
  if (mode === 'libreoffice') return 'libreoffice';
  // Default: fixture on Windows/dev without binaries; libreoffice in Docker when set explicitly
  return process.env.RUNNING_IN_DOCKER === 'true' ? 'libreoffice' : 'fixture';
}

export async function preprocessDesignFile(opts: PreprocessOptions): Promise<PageBundle[]> {
  const mode = getPreprocessMode();
  if (mode === 'fixture') return preprocessWithFixture(opts);
  return preprocessWithLibreOffice(opts);
}
