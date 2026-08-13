import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ensureProjectDir, resolveStoragePath, writeProjectFile } from '../storage.js';
import type { PageBundle, PreprocessOptions } from './types.js';

const execFileAsync = promisify(execFile);

async function which(cmd: string): Promise<string | null> {
  try {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(checker, [cmd]);
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

async function extractPptxTextByPage(sourceAbs: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const unzipBin = await which('unzip');
  if (!unzipBin) return map;
  try {
    const { stdout: listing } = await execFileAsync(unzipBin, ['-Z1', sourceAbs]);
    const slides = listing
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
      .sort((a, b) => Number(a.match(/(\d+)/)?.[1] ?? 0) - Number(b.match(/(\d+)/)?.[1] ?? 0));
    for (const name of slides) {
      const pageNo = Number(name.match(/(\d+)/)?.[1] ?? 0);
      const { stdout: xml } = await execFileAsync(unzipBin, ['-p', sourceAbs, name], {
        maxBuffer: 8 * 1024 * 1024,
      });
      const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1]).filter(Boolean);
      map.set(pageNo, texts.join('\n'));
    }
  } catch {
    /* optional text path — vision pages still work */
  }
  return map;
}

/**
 * Convert office/pdf to page PNGs via LibreOffice + pdftoppm when available.
 */
export async function preprocessWithLibreOffice(opts: PreprocessOptions): Promise<PageBundle[]> {
  const soffice = (await which('soffice')) || (await which('libreoffice'));
  const pdftoppm = await which('pdftoppm');
  if (!soffice || !pdftoppm) {
    throw new Error(
      '缺少 LibreOffice(soffice) 或 poppler(pdftoppm)。可设置 COSTING_PREPROCESS_MODE=fixture 用于本地联调。',
    );
  }

  const sourceAbs = resolveStoragePath(opts.sourceStoragePath);
  const workDir = path.join(await ensureProjectDir(opts.projectId), '_work');
  await mkdir(workDir, { recursive: true });

  let pdfAbs = sourceAbs;
  const lower = opts.fileName.toLowerCase();
  const isPdf = lower.endsWith('.pdf') || opts.contentType.includes('pdf');
  if (!isPdf) {
    await execFileAsync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', workDir, sourceAbs], {
      timeout: 180_000,
    });
    const pdfs = (await readdir(workDir)).filter((f) => f.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) throw new Error('LibreOffice 未能生成 PDF');
    pdfAbs = path.join(workDir, pdfs[0]);
  }

  const prefix = path.join(workDir, 'page');
  await execFileAsync(pdftoppm, ['-png', '-r', '120', pdfAbs, prefix], { timeout: 180_000 });
  const pngs = (await readdir(workDir))
    .filter((f) => /^page-\d+\.png$/i.test(f) || /^page\d+\.png$/i.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/(\d+)/)?.[1] ?? 0);
      return na - nb;
    });
  if (!pngs.length) throw new Error('pdftoppm 未生成页图');

  const textByPage = lower.endsWith('.pptx')
    ? await extractPptxTextByPage(sourceAbs)
    : new Map<number, string>();

  const pages: PageBundle[] = [];
  for (let i = 0; i < pngs.length; i++) {
    const pageNo = i + 1;
    const pngBuf = await readFile(path.join(workDir, pngs[i]));
    const imageRel = `pages/page-${pageNo}.png`;
    const text = textByPage.get(pageNo) ?? '';
    const textRel = `pages/page-${pageNo}.txt`;
    const imageWritten = await writeProjectFile(opts.projectId, imageRel, pngBuf);
    const textWritten = await writeProjectFile(opts.projectId, textRel, Buffer.from(text, 'utf8'));
    pages.push({
      pageNo,
      text,
      imagePath: resolveStoragePath(imageWritten.storagePath),
      imageStoragePath: imageWritten.storagePath,
      textStoragePath: textWritten.storagePath,
    });
  }

  // touch work marker for debugging
  await writeFile(path.join(workDir, 'done.txt'), String(pages.length), 'utf8');
  return pages;
}
